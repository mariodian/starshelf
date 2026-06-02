import type { AiProviderClient } from "./base";
import type { ExtensionSettings } from "../storage";
import { AnthropicClient } from "./anthropic";
import { OpenAIClient } from "./openai";
import { OpenCodeClient } from "./opencode";

const DEFAULT_MODELS: Record<ExtensionSettings["activeProvider"], string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-5-mini",
  opencode: "deepseek-v4-flash",
};

export function createProviderClient(
  provider: ExtensionSettings["activeProvider"],
  config: ExtensionSettings["providers"][ExtensionSettings["activeProvider"]],
): AiProviderClient | null {
  if (!config.apiKey) return null;

  const model =
    "model" in config && config.model ? config.model : DEFAULT_MODELS[provider];

  switch (provider) {
    case "anthropic":
      return new AnthropicClient(config.apiKey, model);
    case "openai":
      return new OpenAIClient(config.apiKey, model);
    case "opencode":
      return new OpenCodeClient(
        config.apiKey,
        model,
        (config as ExtensionSettings["providers"]["opencode"]).endpoint,
      );
    default:
      return null;
  }
}
