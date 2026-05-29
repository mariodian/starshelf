import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIClient } from "@/shared/providers/openai";
import type { RepoMetadata } from "@/shared/github";

const metadata: RepoMetadata = {
  description: "test",
  language: "Python",
  topics: ["ai"],
};

function makeClient() {
  return new OpenAIClient("sk-test", "gpt-5-mini");
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAIClient.categorize", () => {
  it("returns a cleaned category from the API response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "AI Library" } }],
      }),
    } as Response);

    const result = await makeClient().categorize(metadata, "u", "r", []);
    expect(result).toBe("AI Library");
  });

  it("sends the correct request body", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Tool" } }],
      }),
    } as Response);

    await makeClient().categorize(metadata, "owner", "repo", []);

    const [, opts] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);

    expect(body.model).toBe("gpt-5-mini");
    expect(body.max_completion_tokens).toBe(4096);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    } as Response);

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("OpenAI API error 429");
  });

  it("throws when the response has no choices", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    } as Response);

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("OpenAI returned empty response");
  });

  it("throws when message content is missing", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    } as Response);

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("OpenAI returned empty response");
  });
});

describe("OpenAIClient.listModels", () => {
  it("returns sorted gpt/o1/o3 model IDs", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "o3-mini" },
          { id: "dall-e-3" },
          { id: "gpt-5-mini" },
          { id: "gpt-4o" },
          { id: "o1-preview" },
        ],
      }),
    } as Response);

    const models = await makeClient().listModels();
    expect(models).toEqual(["gpt-4o", "gpt-5-mini", "o1-preview", "o3-mini"]);
  });

  it("returns empty array on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
    } as Response);

    const models = await makeClient().listModels();
    expect(models).toEqual([]);
  });

  it("returns empty array when data is not an array", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: null }),
    } as Response);

    const models = await makeClient().listModels();
    expect(models).toEqual([]);
  });
});
