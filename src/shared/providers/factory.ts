import type { AiProviderClient } from "./base";
import type { ExtensionSettings } from "../storage";
import { AnthropicClient } from "./anthropic";
import { ChatCompletionsClient } from "./chat";

const DEFAULT_MODELS: Record<ExtensionSettings["activeProvider"], string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-5-mini",
  opencode: "deepseek-v4-flash",
};

const OPENAI_URL = "https://api.openai.com/v1";

export function openCodeBaseUrl(endpoint: "zen" | "zen-go"): string {
  return endpoint === "zen-go"
    ? "https://opencode.ai/zen/go/v1"
    : "https://opencode.ai/zen/v1";
}

function isOpenAIChatModel(id: string): boolean {
  return id.startsWith("gpt") || id.startsWith("o1") || id.startsWith("o3");
}

export function openAIClient(
  apiKey: string,
  model: string,
): ChatCompletionsClient {
  return new ChatCompletionsClient({
    name: "OpenAI",
    apiKey,
    model,
    baseUrl: OPENAI_URL,
    maxTokensField: "max_completion_tokens",
    acceptModel: isOpenAIChatModel,
  });
}

export function openCodeClient(
  apiKey: string,
  model: string,
  endpoint: "zen" | "zen-go" = "zen",
): ChatCompletionsClient {
  return new ChatCompletionsClient({
    name: "OpenCode",
    apiKey,
    model,
    baseUrl: openCodeBaseUrl(endpoint),
    maxTokensField: "max_tokens",
    temperature: 0,
  });
}

export function createProviderClient(
  provider: ExtensionSettings["activeProvider"],
  providers: ExtensionSettings["providers"],
): AiProviderClient | null {
  switch (provider) {
    case "anthropic": {
      const config = providers.anthropic;
      if (!config.apiKey) return null;
      return new AnthropicClient(
        config.apiKey,
        config.model || DEFAULT_MODELS.anthropic,
      );
    }
    case "openai": {
      const config = providers.openai;
      if (!config.apiKey) return null;
      return openAIClient(config.apiKey, config.model || DEFAULT_MODELS.openai);
    }
    case "opencode": {
      const config = providers.opencode;
      if (!config.apiKey) return null;
      return openCodeClient(
        config.apiKey,
        config.model || DEFAULT_MODELS.opencode,
        config.endpoint,
      );
    }
    default:
      return null;
  }
}
