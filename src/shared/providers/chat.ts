import {
  buildBatchPrompt,
  buildPrompt,
  cleanCategory,
  parseBatchResponse,
  type AiProviderClient,
  type CategorizeBatchRequest,
  type CategorizeRequest,
} from "./base";

const CATEGORIZE_SYSTEM =
  "You are a GitHub repo classifier. Assign a category label using at most 3 nouns. No verbs, no articles, no explanation. Output only the label.";

const BATCH_SYSTEM =
  "You are a GitHub repo classifier. Categorize each repo using at most 3 nouns. Return a JSON object mapping repo full names to category labels. Output ONLY the JSON.";

export interface ChatCompletionsOptions {
  name: string;
  apiKey: string;
  model: string;
  /** Origin plus version path, without /chat/completions. */
  baseUrl: string;
  maxTokensField: "max_tokens" | "max_completion_tokens";
  temperature?: number;
  acceptModel?: (id: string) => boolean;
}

export class ChatCompletionsClient implements AiProviderClient {
  readonly name: string;
  readonly baseUrl: string;

  constructor(private readonly options: ChatCompletionsOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl;
  }

  async categorize(request: CategorizeRequest): Promise<string> {
    const text = await chatCompletion({
      url: `${this.baseUrl}/chat/completions`,
      apiKey: this.options.apiKey,
      model: this.options.model,
      system: CATEGORIZE_SYSTEM,
      user: buildPrompt(
        request.metadata,
        request.owner,
        request.repo,
        request.existingLists,
        request.style,
        request.previousCategories ?? [],
      ),
      maxTokensField: this.options.maxTokensField,
      temperature: this.options.temperature,
      providerName: this.name,
    });
    return cleanCategory(text);
  }

  async categorizeBatch(
    request: CategorizeBatchRequest,
  ): Promise<Map<string, string>> {
    const text = await chatCompletion({
      url: `${this.baseUrl}/chat/completions`,
      apiKey: this.options.apiKey,
      model: this.options.model,
      system: BATCH_SYSTEM,
      user: buildBatchPrompt(
        request.repos,
        request.existingLists,
        request.style,
        request.previousCategories ?? [],
      ),
      maxTokensField: this.options.maxTokensField,
      temperature: this.options.temperature,
      signal: request.signal,
      providerName: this.name,
    });
    return parseBatchResponse(text);
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
    });
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data.data)) return [];

    const ids = data.data.map((model: { id: string }) => model.id);
    const accept = this.options.acceptModel;
    return (accept ? ids.filter(accept) : ids).sort();
  }
}

export async function chatCompletion(options: {
  url: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** OpenAI uses max_completion_tokens. OpenCode uses max_tokens. */
  maxTokensField: "max_tokens" | "max_completion_tokens";
  temperature?: number;
  signal?: AbortSignal;
  providerName: string;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    [options.maxTokensField]: 4096,
  };
  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  const response = await fetch(options.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `${options.providerName} API error ${response.status}: ${text}`,
    );
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  const text = firstNonEmpty(message?.content, message?.reasoning_content);
  if (!text) {
    throw new Error(`${options.providerName} returned empty response`);
  }
  return text;
}

function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}
