import { describe, it, expect, beforeEach } from "vitest";
import { fakeBrowser } from "wxt/testing";

const DEFAULTS = {
  activeProvider: "anthropic",
  listPrivacy: "private",
  providerModels: {},
  providers: {
    anthropic: {},
    openai: {},
    opencode: { endpoint: "zen" },
  },
};

describe("ExtensionStorage", () => {
  beforeEach(async () => {
    await fakeBrowser.reset();
    await browser.storage.local.set(DEFAULTS);
  });

  describe("browser.storage.local get / set / remove", () => {
    it("stores and retrieves a value", async () => {
      await browser.storage.local.set({ key: "hello" });
      const result = await browser.storage.local.get("key");
      expect(result.key).toBe("hello");
    });

    it("returns undefined for missing keys", async () => {
      const result = await browser.storage.local.get("nonexistent");
      expect(result.nonexistent).toBeUndefined();
    });

    it("removes a key", async () => {
      await browser.storage.local.set({ mykey: "value" });
      await browser.storage.local.remove("mykey");
      const result = await browser.storage.local.get("mykey");
      expect(result.mykey).toBeUndefined();
    });

    it("handles complex objects", async () => {
      const obj = { nested: { value: 42 }, list: [1, 2, 3] };
      await browser.storage.local.set({ obj });
      const result = await browser.storage.local.get("obj");
      expect(result.obj).toEqual(obj);
    });
  });

  describe("getSettings", () => {
    it("returns default settings when nothing custom is stored", async () => {
      const { storage } = await import("@/shared/storage");
      const settings = await storage.getSettings();

      expect(settings.activeProvider).toBe("anthropic");
      expect(settings.listPrivacy).toBe("private");
      expect(settings.githubToken).toBeUndefined();
      expect(settings.providers.anthropic).toEqual({});
      expect(settings.providers.openai).toEqual({});
      expect(settings.providers.opencode).toEqual({ endpoint: "zen" });
    });

    it("merges stored values over defaults", async () => {
      await browser.storage.local.set({
        activeProvider: "openai",
        githubToken: "ghp_test",
      });

      const { storage } = await import("@/shared/storage");
      const settings = await storage.getSettings();

      expect(settings.activeProvider).toBe("openai");
      expect(settings.githubToken).toBe("ghp_test");
      expect(settings.listPrivacy).toBe("private");
    });

    it("merges stored provider config with defaults", async () => {
      await browser.storage.local.set({
        providers: {
          anthropic: { apiKey: "sk-ant", model: "claude-sonnet-4" },
          openai: {},
          opencode: { endpoint: "zen" },
        },
      });

      const { storage } = await import("@/shared/storage");
      const settings = await storage.getSettings();

      expect(settings.providers.anthropic).toEqual({
        apiKey: "sk-ant",
        model: "claude-sonnet-4",
      });
      expect(settings.providers.opencode).toEqual({ endpoint: "zen" });
    });
  });

  describe("setSettings", () => {
    it("persists the full settings object", async () => {
      const { storage } = await import("@/shared/storage");

      const settingsObj = {
        activeProvider: "opencode" as const,
        listPrivacy: "public" as const,
        githubToken: "token",
        providers: {
          anthropic: {},
          openai: { apiKey: "sk-key" },
          opencode: { endpoint: "zen-go" as const },
        },
      };

      await storage.setSettings(settingsObj);

      const stored = await browser.storage.local.get([
        "activeProvider",
        "listPrivacy",
        "githubToken",
        "providers",
      ]);
      expect(stored.activeProvider).toBe("opencode");
      expect(stored.githubToken).toBe("token");
      expect((stored.providers as Record<string, unknown>).openai).toEqual({
        apiKey: "sk-key",
      });
    });
  });

  describe("bootstrap", () => {
    it("merges partial settings over defaults", async () => {
      const { storage } = await import("@/shared/storage");

      await storage.bootstrap({
        activeProvider: "openai",
        listPrivacy: "public",
      });

      const settings = await storage.getSettings();

      expect(settings.activeProvider).toBe("openai");
      expect(settings.listPrivacy).toBe("public");
      expect(settings.githubToken).toBeUndefined();
    });

    it("does not overwrite existing values with undefined bootstrap values", async () => {
      const { storage } = await import("@/shared/storage");

      await storage.bootstrap({
        activeProvider: "openai",
      });

      const settings = await storage.getSettings();

      expect(settings.activeProvider).toBe("openai");
      expect(settings.listPrivacy).toBe("private");
    });

    it("merges provider configs with existing", async () => {
      await browser.storage.local.set({
        providers: {
          anthropic: { apiKey: "existing-key" },
          openai: {},
          opencode: { endpoint: "zen" },
        },
      });

      const { storage } = await import("@/shared/storage");

      await storage.bootstrap({
        providers: {
          openai: { apiKey: "new-openai-key" },
          opencode: { endpoint: "zen" as const },
          anthropic: {},
        },
      });

      const settings = await storage.getSettings();

      expect(settings.providers.anthropic.apiKey).toBe("existing-key");
      expect(settings.providers.openai.apiKey).toBe("new-openai-key");
    });
  });
});
