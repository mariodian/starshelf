import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenCodeClient } from "@/shared/providers/opencode";
import type { RepoMetadata } from "@/shared/github";

const metadata: RepoMetadata = {
  description: "test",
  language: "Rust",
  topics: ["compiler"],
};

function makeClient(endpoint: "zen" | "zen-go" = "zen") {
  return new OpenCodeClient("sk-test", "deepseek-v4-flash", endpoint);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenCodeClient.baseUrl", () => {
  it("returns the Zen URL by default", () => {
    expect(makeClient("zen").baseUrl).toBe("https://opencode.ai/zen/v1");
  });

  it("returns the Zen Go URL for zen-go endpoint", () => {
    expect(makeClient("zen-go").baseUrl).toBe("https://opencode.ai/zen/go/v1");
  });
});

describe("OpenCodeClient.categorize", () => {
  it("returns a cleaned category from the content field", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Compiler Tool" } }],
      }),
    } as Response);

    const result = await makeClient().categorize(metadata, "u", "r", []);
    expect(result).toBe("Compiler Tool");
  });

  it("falls back to reasoning_content when content is absent", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              reasoning_content:
                'The repository is about compilers, so the category is "Compiler Tool"',
            },
          },
        ],
      }),
    } as Response);

    const result = await makeClient().categorize(metadata, "u", "r", []);
    expect(result).toBe("Compiler Tool");
  });

  it("extracts category from reasoning using regex patterns", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              reasoning_content: 'classified as "DevTools"',
            },
          },
        ],
      }),
    } as Response);

    const result = await makeClient().categorize(metadata, "u", "r", []);
    expect(result).toBe("DevTools");
  });

  it("falls back to the last line of reasoning text", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              reasoning_content:
                "Let me think about this...\nOK the answer seems clear.\nRust CLI",
            },
          },
        ],
      }),
    } as Response);

    const result = await makeClient().categorize(metadata, "u", "r", []);
    expect(result).toBe("Rust CLI");
  });

  it("uses the correct endpoint for requests", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Tool" } }],
      }),
    } as Response);

    await makeClient("zen-go").categorize(metadata, "u", "r", []);

    expect(fetch).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/chat/completions",
      expect.anything(),
    );
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => "Payment required",
    } as Response);

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("OpenCode API error 402");
  });

  it("throws when there is no content and no reasoning", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    } as Response);

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("OpenCode returned empty response");
  });

  it("throws when choices array is empty", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    } as Response);

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("OpenCode returned empty response");
  });
});

describe("OpenCodeClient.listModels", () => {
  it("returns sorted model IDs", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "opencode/gpt-5.1-codex" },
          { id: "deepseek-v4-flash" },
          { id: "anthropic/claude-sonnet-4" },
        ],
      }),
    } as Response);

    const models = await makeClient().listModels();
    expect(models).toEqual([
      "anthropic/claude-sonnet-4",
      "deepseek-v4-flash",
      "opencode/gpt-5.1-codex",
    ]);
  });

  it("uses zen-go base URL for listModels", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);

    await makeClient("zen-go").listModels();

    expect(fetch).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/models",
      expect.anything(),
    );
  });

  it("returns empty array on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const models = await makeClient().listModels();
    expect(models).toEqual([]);
  });

  it("returns empty array when data is not an array", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { not: "array" } }),
    } as Response);

    const models = await makeClient().listModels();
    expect(models).toEqual([]);
  });
});
