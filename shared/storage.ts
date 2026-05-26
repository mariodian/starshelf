export interface ExtensionSettings {
  githubToken?: string;
  activeProvider: 'anthropic' | 'openai' | 'opencode';
  providers: {
    anthropic: { apiKey?: string; model?: string };
    openai: { apiKey?: string; model?: string };
    opencode: { apiKey?: string; model?: string; endpoint: 'zen' | 'zen-go' };
  };
  categorizedRepos: Record<string, { category: string; starredAt: number }>;
}

// TODO(feature): Add encryption layer around secrets before writing to storage.
// Every call to get/set should optionally pass through encrypt/decrypt transforms.
// Currently secrets are stored in plaintext in browser.storage.local.

class ExtensionStorage {
  async get<T>(key: string): Promise<T | undefined> {
    const result = await browser.storage.local.get(key);
    // TODO(encryption): Decrypt value here if key is a secret
    return result[key] as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    // TODO(encryption): Encrypt value here if key is a secret
    await browser.storage.local.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  }

  async getSettings(): Promise<ExtensionSettings> {
    const defaults: ExtensionSettings = {
      activeProvider: 'anthropic',
      providers: {
        anthropic: {},
        openai: {},
        opencode: { endpoint: 'zen' },
      },
      categorizedRepos: {},
    };
    const keys = Object.keys(defaults) as (keyof ExtensionSettings)[];
    const result = await browser.storage.local.get(keys);
    return { ...defaults, ...result } as ExtensionSettings;
  }

  async setSettings(settings: ExtensionSettings): Promise<void> {
    await browser.storage.local.set(settings);
  }
}

export const storage = new ExtensionStorage();
