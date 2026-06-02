import { describe, it, expect, vi } from "vitest";
import {
  setupFetchMock,
  mockJsonResponse,
  mockHttpError,
} from "@/shared/test-utils";
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

setupFetchMock();

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
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        choices: [{ message: { content: "Compiler Tool" } }],
      }),
    );

    const result = await makeClient().categorize(metadata, "u", "r", []);
    expect(result).toBe("Compiler Tool");
  });

  it("falls back to reasoning_content when content is absent", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        choices: [
          {
            message: {
              reasoning_content:
                'The repository is about compilers, so the category is "Compiler Tool"',
            },
          },
        ],
      }),
    );

    const result = await makeClient().categorize(metadata, "u", "r", []);
    expect(result).toBe("Compiler Tool");
  });

  it("extracts category from reasoning using regex patterns", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        choices: [
          {
            message: {
              reasoning_content: 'classified as "DevTools"',
            },
          },
        ],
      }),
    );

    const result = await makeClient().categorize(metadata, "u", "r", []);
    expect(result).toBe("DevTools");
  });

  it("falls back to the last line of reasoning text", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        choices: [
          {
            message: {
              reasoning_content:
                "Let me think about this...\nOK the answer seems clear.\nRust CLI",
            },
          },
        ],
      }),
    );

    const result = await makeClient().categorize(metadata, "u", "r", []);
    expect(result).toBe("Rust CLI");
  });

  it("uses the correct endpoint for requests", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        choices: [{ message: { content: "Tool" } }],
      }),
    );

    await makeClient("zen-go").categorize(metadata, "u", "r", []);

    expect(fetch).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/chat/completions",
      expect.anything(),
    );
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(mockHttpError(402, "Payment required"));

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("OpenCode API error 402");
  });

  it("throws when there is no content and no reasoning", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({ choices: [{ message: {} }] }),
    );

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("OpenCode returned empty response");
  });

  it("throws when choices array is empty", async () => {
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ choices: [] }));

    await expect(
      makeClient().categorize(metadata, "u", "r", []),
    ).rejects.toThrow("OpenCode returned empty response");
  });
});

describe("OpenCodeClient.listModels", () => {
  it("returns sorted model IDs", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({
        data: [
          { id: "opencode/gpt-5.1-codex" },
          { id: "deepseek-v4-flash" },
          { id: "anthropic/claude-sonnet-4" },
        ],
      }),
    );

    const models = await makeClient().listModels();
    expect(models).toEqual([
      "anthropic/claude-sonnet-4",
      "deepseek-v4-flash",
      "opencode/gpt-5.1-codex",
    ]);
  });

  it("uses zen-go base URL for listModels", async () => {
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ data: [] }));

    await makeClient("zen-go").listModels();

    expect(fetch).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/models",
      expect.anything(),
    );
  });

  it("returns empty array on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(mockHttpError(500));

    const models = await makeClient().listModels();
    expect(models).toEqual([]);
  });

  it("returns empty array when data is not an array", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockJsonResponse({ data: { not: "array" } }),
    );

    const models = await makeClient().listModels();
    expect(models).toEqual([]);
  });
});
