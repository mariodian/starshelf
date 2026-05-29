import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicClient } from "@/shared/providers/anthropic";
import type { RepoMetadata } from "@/shared/github";

const metadata: RepoMetadata = {
  description: "test",
  language: "Go",
  topics: ["cli"],
};

function makeClient() {
  return new AnthropicClient("sk-test", "claude-haiku-4-5");
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnthropicClient.categorize", () => {
  it("returns a cleaned category from the API response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: "CLI Tool" }] }),
    } as Response);

    const result = await makeClient().categorize(metadata, "u", "r", []);
    expect(result).toBe("CLI Tool");
  });

  it("sends the correct request body", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: "Tool" }] }),
    } as Response);

    await makeClient().categorize(metadata, "owner", "repo", []);

    const [, opts] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);

    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.max_tokens).toBe(4096);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain("Repository: owner/repo");
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    } as Response);

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("Anthropic API error 401");
  });

  it("throws when the response content is empty", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    } as Response);

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("Anthropic returned empty response");
  });

  it("throws when content text is missing", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ notText: true }] }),
    } as Response);

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("Anthropic returned empty response");
  });
});

describe("AnthropicClient.listModels", () => {
  it("returns sorted claude-ids", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "claude-sonnet-4-20250514" },
          { id: "not-anthropic-model" },
          { id: "claude-haiku-4-5-20251001" },
        ],
      }),
    } as Response);

    const models = await makeClient().listModels();
    expect(models).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-20250514",
    ]);
  });

  it("returns empty array on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
    } as Response);

    const models = await makeClient().listModels();
    expect(models).toEqual([]);
  });

  it("returns empty array when data is not an array", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: "not-array" }),
    } as Response);

    const models = await makeClient().listModels();
    expect(models).toEqual([]);
  });
});
