import {
  buildPrompt,
  cleanCategory,
  buildBatchPrompt,
  parseBatchResponse,
  type AiProviderClient,
  type CategorizeBatchRequest,
  type CategorizeRequest,
} from "./base";

export class AnthropicClient implements AiProviderClient {
  readonly name = "Anthropic";

  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async listModels(): Promise<string[]> {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data.data)) return [];

    return data.data
      .map((m: { id: string }) => m.id)
      .filter((id: string) => id.startsWith("claude-"))
      .sort();
  }

  async categorize(request: CategorizeRequest): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: buildPrompt(
              request.metadata,
              request.owner,
              request.repo,
              request.existingLists,
              request.style,
              request.previousCategories ?? [],
            ),
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    if (!data.content?.[0]?.text) {
      throw new Error("Anthropic returned empty response");
    }
    return cleanCategory(data.content[0].text);
  }

  async categorizeBatch(
    request: CategorizeBatchRequest,
  ): Promise<Map<string, string>> {
    const prompt = buildBatchPrompt(
      request.repos,
      request.existingLists,
      request.style,
      request.previousCategories ?? [],
    );

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    if (!data.content?.[0]?.text) {
      throw new Error("Anthropic returned empty response");
    }
    return parseBatchResponse(data.content[0].text);
  }
}
