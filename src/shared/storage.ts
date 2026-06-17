export interface RepoRecord {
  owner: string;
  repo: string;
  fullName: string;
  nodeId: string;
  description?: string;
  language?: string;
  topics: string[];
  listId?: string;
  listName?: string;
  starredAt: string;
  updatedAt: string;
}

export type RepoIndex = Record<string, RepoRecord>;

export interface ExtensionSettings {
  githubToken?: string;
  activeProvider: "anthropic" | "openai" | "opencode";
  providers: {
    anthropic: { apiKey?: string; model?: string };
    openai: { apiKey?: string; model?: string };
    opencode: { apiKey?: string; model?: string; endpoint: "zen" | "zen-go" };
  };
  listPrivacy: "public" | "private";
  enableEmojis: boolean;
  enableCategoryPrefix: boolean;
  autoFormat: boolean;
  providerModels?: Record<string, string[]>;
}

export interface StorageBackend {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export class LocalStorageBackend implements StorageBackend {
  async get<T>(key: string): Promise<T | undefined> {
    const result = await browser.storage.local.get(key);
    return result[key] as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  }
}

export class ExtensionStorage {
  constructor(private backend: StorageBackend = new LocalStorageBackend()) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.backend.get<T>(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.backend.set(key, value);
  }

  async remove(key: string): Promise<void> {
    await this.backend.remove(key);
  }

  async getSettings(): Promise<ExtensionSettings> {
    const defaults: ExtensionSettings = {
      activeProvider: "anthropic",
      githubToken: undefined,
      providers: {
        anthropic: {},
        openai: {},
        opencode: { endpoint: "zen" },
      },
      listPrivacy: "private",
      enableEmojis: false,
      enableCategoryPrefix: false,
      autoFormat: true,
      providerModels: {},
    };
    const keys = Object.keys(defaults) as (keyof ExtensionSettings)[];
    const result = await browser.storage.local.get(keys);
    const settings = { ...defaults, ...result } as ExtensionSettings;

    if (import.meta.env.DEV) {
      applyEnvOverrides(settings);
    }

    return settings;
  }

  async setSettings(settings: ExtensionSettings): Promise<void> {
    await browser.storage.local.set(settings);
  }

  async getRepos(): Promise<RepoIndex> {
    return (await this.backend.get<RepoIndex>("repos")) ?? {};
  }

  async saveRepo(record: RepoRecord): Promise<void> {
    const repos = await this.getRepos();
    repos[record.fullName] = record;
    await this.backend.set("repos", repos);
  }

  async removeRepo(fullName: string): Promise<void> {
    const repos = await this.getRepos();
    delete repos[fullName];
    await this.backend.set("repos", repos);
  }

  async getRepoCount(): Promise<number> {
    const repos = await this.getRepos();
    return Object.keys(repos).length;
  }

  async clearRepos(): Promise<void> {
    await this.backend.set("repos", {});
  }

  async bootstrap(partial: Partial<ExtensionSettings>): Promise<void> {
    const current = await this.getSettings();

    const merged: ExtensionSettings = {
      ...current,
      activeProvider: partial.activeProvider ?? current.activeProvider,
      githubToken: partial.githubToken ?? current.githubToken,
      listPrivacy: partial.listPrivacy ?? current.listPrivacy,
      enableEmojis: partial.enableEmojis ?? current.enableEmojis,
      enableCategoryPrefix:
        partial.enableCategoryPrefix ?? current.enableCategoryPrefix,
      autoFormat: partial.autoFormat ?? current.autoFormat,
      providers: {
        anthropic: {
          apiKey:
            partial.providers?.anthropic?.apiKey ??
            current.providers.anthropic.apiKey,
          model:
            partial.providers?.anthropic?.model ??
            current.providers.anthropic.model,
        },
        openai: {
          apiKey:
            partial.providers?.openai?.apiKey ??
            current.providers.openai.apiKey,
          model:
            partial.providers?.openai?.model ?? current.providers.openai.model,
        },
        opencode: {
          apiKey:
            partial.providers?.opencode?.apiKey ??
            current.providers.opencode.apiKey,
          model:
            partial.providers?.opencode?.model ??
            current.providers.opencode.model,
          endpoint:
            partial.providers?.opencode?.endpoint ??
            current.providers.opencode.endpoint ??
            "zen",
        },
      },
    };

    await this.setSettings(merged);
  }
}

function applyEnvOverrides(settings: ExtensionSettings): void {
  const activeProvider = import.meta.env.VITE_ACTIVE_PROVIDER;
  if (
    activeProvider === "anthropic" ||
    activeProvider === "openai" ||
    activeProvider === "opencode"
  ) {
    settings.activeProvider = activeProvider;
  }

  const githubToken = import.meta.env.VITE_GITHUB_TOKEN;
  if (githubToken) {
    settings.githubToken = githubToken;
  }

  const listPrivacy = import.meta.env.VITE_LIST_PRIVACY;
  if (listPrivacy === "public" || listPrivacy === "private") {
    settings.listPrivacy = listPrivacy;
  }

  const anthropicKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  const anthropicModel = import.meta.env.VITE_ANTHROPIC_MODEL;
  if (anthropicKey) settings.providers.anthropic.apiKey = anthropicKey;
  if (anthropicModel) settings.providers.anthropic.model = anthropicModel;

  const openaiKey = import.meta.env.VITE_OPENAI_API_KEY;
  const openaiModel = import.meta.env.VITE_OPENAI_MODEL;
  if (openaiKey) settings.providers.openai.apiKey = openaiKey;
  if (openaiModel) settings.providers.openai.model = openaiModel;

  const opencodeKey = import.meta.env.VITE_OPENCODE_API_KEY;
  const opencodeModel = import.meta.env.VITE_OPENCODE_MODEL;
  const opencodeEndpoint = import.meta.env.VITE_OPENCODE_ENDPOINT;
  if (opencodeKey) settings.providers.opencode.apiKey = opencodeKey;
  if (opencodeModel) settings.providers.opencode.model = opencodeModel;
  if (opencodeEndpoint === "zen" || opencodeEndpoint === "zen-go") {
    settings.providers.opencode.endpoint = opencodeEndpoint;
  }
}

export const storage = new ExtensionStorage();
