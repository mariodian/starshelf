import type { AiProviderClient } from "./base";
import type { RepoMetadata } from "../github";
import { buildPrompt, cleanCategory } from "./base";

export class OpenAIClient implements AiProviderClient {
  readonly name = "OpenAI";

  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async categorize(
    metadata: RepoMetadata,
    owner: string,
    repo: string,
    existingLists: string[],
    enableEmojis = false,
    enableCategoryPrefix = false,
    autoFormat = true,
  ): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
        max_completion_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    if (!data.choices?.[0]?.message?.content) {
      throw new Error("OpenAI returned empty response");
    }
    return cleanCategory(data.choices[0].message.content);
  }

  async listModels(): Promise<string[]> {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data.data)) return [];

    return data.data
      .map((m: { id: string }) => m.id)
      .filter(
        (id: string) =>
          id.startsWith("gpt") || id.startsWith("o1") || id.startsWith("o3"),
      )
      .sort();
  }
}
