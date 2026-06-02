import { describe, it, expect, vi } from "vitest";
import {
  setupFetchMock,
  mockJsonResponse,
  mockHttpError,
} from "@/shared/test-utils";
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

setupFetchMock();

describe("AnthropicClient.categorize", () => {
  it("returns a cleaned category from the API response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({ content: [{ text: "CLI Tool" }] }),
    );

    const result = await makeClient().categorize(metadata, "u", "r", []);
    expect(result).toBe("CLI Tool");
  });

  it("sends the correct request body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({ content: [{ text: "Tool" }] }),
    );

    await makeClient().categorize(metadata, "owner", "repo", []);

    const [, opts] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);

    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.max_tokens).toBe(4096);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain("Repository: owner/repo");
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(mockHttpError(401, "Unauthorized"));

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("Anthropic API error 401");
  });

  it("throws when the response content is empty", async () => {
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ content: [] }));

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("Anthropic returned empty response");
  });

  it("throws when content text is missing", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({ content: [{ notText: true }] }),
    );

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("Anthropic returned empty response");
  });
});

describe("AnthropicClient.listModels", () => {
  it("returns sorted claude-ids", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        data: [
          { id: "claude-sonnet-4-20250514" },
          { id: "not-anthropic-model" },
          { id: "claude-haiku-4-5-20251001" },
        ],
      }),
    );

    const models = await makeClient().listModels();
    expect(models).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-20250514",
    ]);
  });

  it("returns empty array on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(mockHttpError(403));

    const models = await makeClient().listModels();
    expect(models).toEqual([]);
  });

  it("returns empty array when data is not an array", async () => {
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ data: "not-array" }));

    const models = await makeClient().listModels();
    expect(models).toEqual([]);
  });
});
