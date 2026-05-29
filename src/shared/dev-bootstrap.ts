import { storage } from "@/shared/storage";
import type { ExtensionSettings } from "@/shared/storage";

function readEnvSettings(): Partial<ExtensionSettings> {
  const partial: Partial<ExtensionSettings> = {};

  const githubToken = import.meta.env.VITE_GITHUB_TOKEN;
  if (githubToken) partial.githubToken = githubToken;

  const activeProvider = import.meta.env.VITE_ACTIVE_PROVIDER;
  if (
    activeProvider === "anthropic" ||
    activeProvider === "openai" ||
    activeProvider === "opencode"
  ) {
    partial.activeProvider = activeProvider;
  }

  const listPrivacy = import.meta.env.VITE_LIST_PRIVACY;
  if (listPrivacy === "public" || listPrivacy === "private") {
    partial.listPrivacy = listPrivacy;
  }

  const providers: Partial<ExtensionSettings["providers"]> = {};

  const anthropicKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  const anthropicModel = import.meta.env.VITE_ANTHROPIC_MODEL;
  if (anthropicKey || anthropicModel) {
    providers.anthropic = {};
    if (anthropicKey) providers.anthropic.apiKey = anthropicKey;
    if (anthropicModel) providers.anthropic.model = anthropicModel;
  }

  const openaiKey = import.meta.env.VITE_OPENAI_API_KEY;
  const openaiModel = import.meta.env.VITE_OPENAI_MODEL;
  if (openaiKey || openaiModel) {
    providers.openai = {};
    if (openaiKey) providers.openai.apiKey = openaiKey;
    if (openaiModel) providers.openai.model = openaiModel;
  }

  const opencodeKey = import.meta.env.VITE_OPENCODE_API_KEY;
  const opencodeModel = import.meta.env.VITE_OPENCODE_MODEL;
  const opencodeEndpoint = import.meta.env.VITE_OPENCODE_ENDPOINT as
    | "zen"
    | "zen-go"
    | undefined;
  if (opencodeKey || opencodeModel || opencodeEndpoint) {
    providers.opencode = { endpoint: "zen" };
    if (opencodeKey) providers.opencode.apiKey = opencodeKey;
    if (opencodeModel) providers.opencode.model = opencodeModel;
    if (opencodeEndpoint) providers.opencode.endpoint = opencodeEndpoint;
  }

  if (Object.keys(providers).length > 0) {
    partial.providers = providers as ExtensionSettings["providers"];
  }

  return partial;
}

export async function seedFromEnvIfMissing() {
  const partial = readEnvSettings();
  await storage.bootstrap(partial);
}
