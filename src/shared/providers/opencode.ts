import type { AiProviderClient } from "./base";
import type { RepoMetadata } from "../github";
import { buildPrompt, cleanCategory } from "./base";

// OpenCode Zen and Go use an OpenAI-compatible chat completions API.
// Model IDs follow the pattern provider_id/model_id (e.g. opencode/gpt-5.1-codex).
// Endpoints:
//   Zen:  https://opencode.ai/zen/v1/chat/completions
//   Go:   https://opencode.ai/zen/go/v1/chat/completions
// Note: Some Go models (MiniMax, Qwen) use the Anthropic /messages endpoint.
// For those, configure the model manually and switch the endpoint in settings.

export class OpenCodeClient implements AiProviderClient {
  readonly name = "OpenCode";

  constructor(
    private apiKey: string,
    private model: string,
    private endpoint: "zen" | "zen-go" = "zen",
  ) {}

  get baseUrl(): string {
    return this.endpoint === "zen-go"
      ? "https://opencode.ai/zen/go/v1"
      : "https://opencode.ai/zen/v1";
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data.data)) return [];

    return data.data.map((m: { id: string }) => m.id).sort();
  }

  async categorize(
    metadata: RepoMetadata,
    owner: string,
    repo: string,
    existingLists: string[],
    enableEmojis = false,
    enableCategoryPrefix = false,
    autoFormat = true,
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "You are a GitHub repo classifier. Assign a category label using at most 3 nouns. No verbs, no articles, no explanation. Output only the label.",
          },
          {
            role: "user",
            content: buildPrompt(
              metadata,
              owner,
              repo,
              existingLists,
              enableEmojis,
              enableCategoryPrefix,
              autoFormat,
            ),
          },
        ],
        max_tokens: 4096,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenCode API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    // Primary: use content field
    const content = choice?.message?.content;
    if (content) return cleanCategory(content);

    // Fallback: reasoning models (e.g. DeepSeek) put output in reasoning_content
    const reasoning = choice?.message?.reasoning_content;
    if (reasoning) {
      const extracted = extractCategory(reasoning);
      if (extracted) return cleanCategory(extracted);
    }

    throw new Error("OpenCode returned empty response");
  }
}

function extractCategory(text: string): string | null {
  // Try explicit category declarations in the reasoning
  for (const re of [
    /category(?:\s+is)?[:\s]+["']?([\w\s-]+?)["']?(?:\.|$)/im,
    /(?:would be|should be|is)\s+["']?([\w\s-]+?)["']?(?:\.|$)/im,
    /classified\s+as\s+["']?([\w\s-]+?)["']?(?:\.|$)/im,
    /["']([\w\s-]{2,30})["']/g,
  ]) {
    const m = text.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }

  // Last line as fallback
  const lines = text.split("\n").filter((l) => l.trim());
  const last = lines[lines.length - 1]?.trim();
  if (last && last.length <= 40) {
    return last.replace(/[^\w\s-]/g, "").trim();
  }

  return null;
}
