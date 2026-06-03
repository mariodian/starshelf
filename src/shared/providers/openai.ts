import type { AiProviderClient, BatchCategorizeRepo } from "./base";
import type { RepoMetadata } from "../github";
import {
  buildPrompt,
  cleanCategory,
  buildBatchPrompt,
  parseBatchResponse,
} from "./base";

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
    previousCategories: string[] = [],
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
              previousCategories,
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

  async categorizeBatch(
    repos: BatchCategorizeRepo[],
    existingLists: string[],
    enableEmojis = false,
    enableCategoryPrefix = false,
    autoFormat = true,
    previousCategories: string[] = [],
    signal?: AbortSignal,
  ): Promise<Map<string, string>> {
    const prompt = buildBatchPrompt(
      repos,
      existingLists,
      enableEmojis,
      enableCategoryPrefix,
      autoFormat,
      previousCategories,
    );

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
              "You are a GitHub repo classifier. Categorize each repo using at most 3 nouns. Return a JSON object mapping repo full names to category labels. Output ONLY the JSON.",
          },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 4096,
      }),
      signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    if (!data.choices?.[0]?.message?.content) {
      throw new Error("OpenAI returned empty response");
    }
    return parseBatchResponse(data.choices[0].message.content);
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
