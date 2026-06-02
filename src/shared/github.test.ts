import { describe, it, expect, vi } from "vitest";
import { setupFetchMock, mockJsonResponse } from "./test-utils";
import {
  parseRepoFromUrl,
  isRepoPage,
  fetchRepoMetadata,
  checkStarStatus,
} from "@/shared/github";

setupFetchMock();

describe("parseRepoFromUrl", () => {
  it("extracts owner and repo from a standard GitHub URL", () => {
    const result = parseRepoFromUrl("https://github.com/facebook/react");
    expect(result).toEqual({
      owner: "facebook",
      repo: "react",
      fullName: "facebook/react",
    });
  });

  it("strips trailing slash from the repo name", () => {
    const result = parseRepoFromUrl("https://github.com/vuejs/core/");
    expect(result).toEqual({
      owner: "vuejs",
      repo: "core",
      fullName: "vuejs/core",
    });
  });

  it("extracts owner and repo ignoring extra path segments", () => {
    const result = parseRepoFromUrl(
      "https://github.com/torvalds/linux/tree/master",
    );
    expect(result).toEqual({
      owner: "torvalds",
      repo: "linux",
      fullName: "torvalds/linux",
    });
  });

  it("returns null for a non-GitHub URL", () => {
    expect(parseRepoFromUrl("https://gitlab.com/user/repo")).toBeNull();
  });

  it("returns null for the GitHub homepage", () => {
    expect(parseRepoFromUrl("https://github.com")).toBeNull();
  });

  it("returns null for a GitHub user profile", () => {
    expect(parseRepoFromUrl("https://github.com/aklinker1")).toBeNull();
  });
});

describe("isRepoPage", () => {
  it("returns true for a valid repo URL", () => {
    expect(isRepoPage("https://github.com/facebook/react")).toBe(true);
  });

  it("returns true for a repo URL with trailing slash", () => {
    expect(isRepoPage("https://github.com/facebook/react/")).toBe(true);
  });

  it("returns false for a subpage of a repo", () => {
    expect(isRepoPage("https://github.com/facebook/react/issues")).toBe(false);
  });

  it("returns false for the GitHub homepage", () => {
    expect(isRepoPage("https://github.com")).toBe(false);
  });

  it("returns false for a non-GitHub URL", () => {
    expect(isRepoPage("https://gitlab.com/user/repo")).toBe(false);
  });
});

describe("fetchRepoMetadata", () => {
  it("returns repo metadata with description and language", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockJsonResponse({
          description:
            "A declarative, efficient, and flexible JavaScript library",
          language: "JavaScript",
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ names: ["ui", "frontend"] }));

    const result = await fetchRepoMetadata("facebook", "react");

    expect(result).toEqual({
      description: "A declarative, efficient, and flexible JavaScript library",
      language: "JavaScript",
      topics: ["ui", "frontend"],
    });
  });

  it("returns empty topics when the topics API fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockJsonResponse({ description: "test", language: "Rust" }),
      )
      .mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchRepoMetadata("user", "repo");

    expect(result.topics).toEqual([]);
    expect(result.description).toBe("test");
  });

  it("sends the Authorization header when a token is provided", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockJsonResponse({}))
      .mockResolvedValueOnce(mockJsonResponse({ names: [] }));

    await fetchRepoMetadata("owner", "repo", "ghp_test");

    const [, opts] = vi.mocked(fetch).mock.calls[0];
    const headers = (opts as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("token ghp_test");
  });

  it("handles a non-ok repo response gracefully", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockJsonResponse({}, 500))
      .mockResolvedValueOnce(mockJsonResponse({ names: [] }));

    const result = await fetchRepoMetadata("user", "repo");

    expect(result.description).toBeUndefined();
    expect(result.language).toBeUndefined();
  });
});

describe("checkStarStatus", () => {
  it("returns true when the repo is starred (204)", async () => {
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse(undefined, 204));

    const result = await checkStarStatus("owner", "repo", "token");

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/user/starred/owner/repo",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "token token",
        }),
      }),
    );
  });

  it("returns false when the repo is not starred (404)", async () => {
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse(undefined, 404));

    const result = await checkStarStatus("owner", "repo", "token");

    expect(result).toBe(false);
  });
});
