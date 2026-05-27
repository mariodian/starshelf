export interface ExtensionSettings {
  githubToken?: string;
  activeProvider: 'anthropic' | 'openai' | 'opencode';
  providers: {
    anthropic: { apiKey?: string; model?: string };
    openai: { apiKey?: string; model?: string };
    opencode: { apiKey?: string; model?: string; endpoint: 'zen' | 'zen-go' };
  };
  categorizedRepos: Record<string, { category: string; starredAt: number }>;
  listPrivacy: 'public' | 'private';
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
      activeProvider: 'anthropic',
      githubToken: undefined,
      providers: {
        anthropic: {},
        openai: {},
        opencode: { endpoint: 'zen' },
      },
      categorizedRepos: {},
      listPrivacy: 'private',
    };
    const keys = Object.keys(defaults) as (keyof ExtensionSettings)[];
    const result = await browser.storage.local.get(keys);
    return { ...defaults, ...result } as ExtensionSettings;
  }

  async setSettings(settings: ExtensionSettings): Promise<void> {
    await browser.storage.local.set(settings);
  }

  async bootstrap(partial: Partial<ExtensionSettings>): Promise<void> {
    const current = await this.getSettings();

    const merged: ExtensionSettings = {
      ...current,
      activeProvider: partial.activeProvider ?? current.activeProvider,
      githubToken: partial.githubToken ?? current.githubToken,
      listPrivacy: partial.listPrivacy ?? current.listPrivacy,
      providers: {
        anthropic: {
          apiKey: partial.providers?.anthropic?.apiKey ?? current.providers.anthropic.apiKey,
          model: partial.providers?.anthropic?.model ?? current.providers.anthropic.model,
        },
        openai: {
          apiKey: partial.providers?.openai?.apiKey ?? current.providers.openai.apiKey,
          model: partial.providers?.openai?.model ?? current.providers.openai.model,
        },
        opencode: {
          apiKey: partial.providers?.opencode?.apiKey ?? current.providers.opencode.apiKey,
          model: partial.providers?.opencode?.model ?? current.providers.opencode.model,
          endpoint: partial.providers?.opencode?.endpoint ?? current.providers.opencode.endpoint ?? 'zen',
        },
      },
    };

    await this.setSettings(merged);
  }
}

export const storage = new ExtensionStorage();
