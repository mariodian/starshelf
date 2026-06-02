import { describe, it, expect, vi } from "vitest";
import {
  setupFetchMock,
  mockJsonResponse,
  mockHttpError,
} from "@/shared/test-utils";
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

setupFetchMock();

describe("OpenAIClient.categorize", () => {
  it("returns a cleaned category from the API response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        choices: [{ message: { content: "AI Library" } }],
      }),
    );

    const result = await makeClient().categorize(metadata, "u", "r", []);
    expect(result).toBe("AI Library");
  });

  it("sends the correct request body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        choices: [{ message: { content: "Tool" } }],
      }),
    );

    await makeClient().categorize(metadata, "owner", "repo", []);

    const [, opts] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);

    expect(body.model).toBe("gpt-5-mini");
    expect(body.max_completion_tokens).toBe(4096);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(mockHttpError(429, "Rate limited"));

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("OpenAI API error 429");
  });

  it("throws when the response has no choices", async () => {
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ choices: [] }));

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("OpenAI returned empty response");
  });

  it("throws when message content is missing", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({ choices: [{ message: {} }] }),
    );

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("OpenAI returned empty response");
  });
});

describe("OpenAIClient.listModels", () => {
  it("returns sorted gpt/o1/o3 model IDs", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        data: [
          { id: "o3-mini" },
          { id: "dall-e-3" },
          { id: "gpt-5-mini" },
          { id: "gpt-4o" },
          { id: "o1-preview" },
        ],
      }),
    );

    const models = await makeClient().listModels();
    expect(models).toEqual(["gpt-4o", "gpt-5-mini", "o1-preview", "o3-mini"]);
  });

  it("returns empty array on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(mockHttpError(401));

    const models = await makeClient().listModels();
    expect(models).toEqual([]);
  });

  it("returns empty array when data is not an array", async () => {
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ data: null }));

    const models = await makeClient().listModels();
    expect(models).toEqual([]);
  });
});
