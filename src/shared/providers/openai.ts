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

export class OpenAIClient implements AiProviderClient {
  readonly name = "OpenAI";

  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async categorize(request: CategorizeRequest): Promise<string> {
    const text = await chatCompletion({
      url: "https://api.openai.com/v1/chat/completions",
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
      maxTokensField: "max_completion_tokens",
      providerName: this.name,
    });
    return cleanCategory(text);
  }

  async categorizeBatch(
    request: CategorizeBatchRequest,
  ): Promise<Map<string, string>> {
    const text = await chatCompletion({
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: this.apiKey,
      model: this.model,
      system: BATCH_SYSTEM,
      user: buildBatchPrompt(
        request.repos,
        request.existingLists,
        request.style,
        request.previousCategories ?? [],
      ),
      maxTokensField: "max_completion_tokens",
      signal: request.signal,
      providerName: this.name,
    });
    return parseBatchResponse(text);
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
