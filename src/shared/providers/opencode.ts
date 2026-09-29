import { chatCompletion } from "./chat";
import {
  buildPrompt,
  cleanCategory,
  buildBatchPrompt,
  parseBatchResponse,
  type AiProviderClient,
  type CategorizeBatchRequest,
  type CategorizeRequest,
} from "./base";

const CATEGORIZE_SYSTEM =
  "You are a GitHub repo classifier. Assign a category label using at most 3 nouns. No verbs, no articles, no explanation. Output only the label.";

const BATCH_SYSTEM =
  "You are a GitHub repo classifier. Categorize each repo using at most 3 nouns. Return a JSON object mapping repo full names to category labels. Output ONLY the JSON.";

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

  async categorize(request: CategorizeRequest): Promise<string> {
    const text = await chatCompletion({
      url: `${this.baseUrl}/chat/completions`,
      apiKey: this.apiKey,
      model: this.model,
      system: CATEGORIZE_SYSTEM,
      user: buildPrompt(
        request.metadata,
        request.owner,
        request.repo,
        request.existingLists,
        request.style,
        request.previousCategories ?? [],
      ),
      maxTokensField: "max_tokens",
      temperature: 0,
      providerName: this.name,
    });
    return cleanCategory(text);
  }

  async categorizeBatch(
    request: CategorizeBatchRequest,
  ): Promise<Map<string, string>> {
    const text = await chatCompletion({
      url: `${this.baseUrl}/chat/completions`,
      apiKey: this.apiKey,
      model: this.model,
      system: BATCH_SYSTEM,
      user: buildBatchPrompt(
        request.repos,
        request.existingLists,
        request.style,
        request.previousCategories ?? [],
      ),
      maxTokensField: "max_tokens",
      temperature: 0,
      signal: request.signal,
      providerName: this.name,
    });
    return parseBatchResponse(text);
  }
}
