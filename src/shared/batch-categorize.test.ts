import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { graphqlDispatcher } from "@/shared/test-utils";
import { batchCategorize } from "@/shared/batch-categorize";
import {
  DEFAULT_CATEGORY_STYLE,
  type AiProviderClient,
} from "@/shared/providers/base";

function starredRepos(
  repos: unknown[],
  pageInfo?: { hasNextPage: boolean; endCursor: string | null },
) {
  return {
    viewer: {
      starredRepositories: {
        pageInfo: pageInfo ?? { hasNextPage: false, endCursor: null },
        nodes: repos.map((r) => ({
          primaryLanguage: null,
          repositoryTopics: { nodes: [] },
          description: null,
          ...(r as Record<string, unknown>),
        })),
      },
    },
  };
}

function userLists(lists: unknown[]) {
  return { viewer: { lists: { nodes: lists } } };
}

function userListsWithItems(lists: unknown[]) {
  return { viewer: { lists: { nodes: lists } } };
}

describe("batchCategorize", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("setTimeout", ((cb: () => void) => {
      cb();
      return 0;
    }) as typeof setTimeout);
    vi.stubGlobal("clearTimeout", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockClient(catMap: [string, string][]): AiProviderClient {
    const categorizeBatch = vi.fn<AiProviderClient["categorizeBatch"]>();
    categorizeBatch.mockResolvedValue(new Map(catMap));
    return { name: "test", categorize: vi.fn(), categorizeBatch };
  }

  it("categorizes uncategorized repos using existing and new lists", async () => {
    vi.mocked(fetch).mockImplementation(
      graphqlDispatcher({
        createUserList: {
          createUserList: {
            list: { id: "L2", name: "CLI Tools", isPrivate: true },
          },
        },
        starredRepositories: starredRepos([
          {
            id: "R1",
            nameWithOwner: "o/r1",
            description: "A CLI tool",
            primaryLanguage: { name: "Rust" },
            repositoryTopics: { nodes: [{ topic: { name: "cli" } }] },
          },
          {
            id: "R2",
            nameWithOwner: "o/r2",
            description: "A React component",
            primaryLanguage: { name: "TypeScript" },
            repositoryTopics: { nodes: [{ topic: { name: "react" } }] },
          },
        ]),
        lists: userLists([{ id: "L1", name: "Frontend", isPrivate: false }]),
        listItems: userListsWithItems([
          {
            id: "L1",
            items: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        ]),
      }),
    );

    const client = mockClient([
      ["o/r1", "CLI Tools"],
      ["o/r2", "Frontend"],
    ]);
    const onProgress = vi.fn();

    const result = await batchCategorize({
      token: "token",
      client,
      settings: { listPrivacy: "private", style: DEFAULT_CATEGORY_STYLE },
      onProgress,
    });

    expect(result.categorized).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(client.categorizeBatch).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(6);
  });

  it("returns empty result when all repos are already categorized", async () => {
    vi.mocked(fetch).mockImplementation(
      graphqlDispatcher({
        starredRepositories: starredRepos([
          { id: "R1", nameWithOwner: "o/r1" },
        ]),
        lists: userLists([{ id: "L1", name: "Test", isPrivate: false }]),
        listItems: userListsWithItems([
          {
            id: "L1",
            items: {
              nodes: [{ id: "R1" }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        ]),
      }),
    );

    const client = mockClient([]);
    const result = await batchCategorize({
      token: "token",
      client,
      settings: { listPrivacy: "private", style: DEFAULT_CATEGORY_STYLE },
    });

    expect(result.categorized).toBe(0);
    expect(result.failed).toBe(0);
    expect(client.categorizeBatch).not.toHaveBeenCalled();
  });

  it("handles partial failure when a repo is missing from AI batch response", async () => {
    vi.mocked(fetch).mockImplementation(
      graphqlDispatcher({
        starredRepositories: starredRepos([
          { id: "R1", nameWithOwner: "o/r1", description: "desc1" },
          { id: "R2", nameWithOwner: "o/r2", description: "desc2" },
        ]),
        lists: userLists([{ id: "L1", name: "Test", isPrivate: false }]),
        listItems: userListsWithItems([
          {
            id: "L1",
            items: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        ]),
      }),
    );

    const categorizeBatch = vi.fn<AiProviderClient["categorizeBatch"]>();
    categorizeBatch.mockResolvedValue(new Map([["o/r1", "Test"]]));
    const client: AiProviderClient = {
      name: "test",
      categorize: vi.fn(),
      categorizeBatch,
    };

    const result = await batchCategorize({
      token: "token",
      client,
      settings: { listPrivacy: "private", style: DEFAULT_CATEGORY_STYLE },
    });

    expect(result.categorized).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].repoName).toBe("o/r2");
    expect(result.errors[0].error).toBe("No category returned for repo");
  });

  it("fails entire chunk when AI batch call fails", async () => {
    vi.mocked(fetch).mockImplementation(
      graphqlDispatcher({
        starredRepositories: starredRepos([
          { id: "R1", nameWithOwner: "o/r1", description: "desc1" },
          { id: "R2", nameWithOwner: "o/r2", description: "desc2" },
        ]),
        lists: userLists([{ id: "L1", name: "Test", isPrivate: false }]),
        listItems: userListsWithItems([
          {
            id: "L1",
            items: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        ]),
      }),
    );

    const categorizeBatch = vi.fn<AiProviderClient["categorizeBatch"]>();
    categorizeBatch.mockRejectedValue(new Error("AI API rate limited"));
    const client: AiProviderClient = {
      name: "test",
      categorize: vi.fn(),
      categorizeBatch,
    };

    const result = await batchCategorize({
      token: "token",
      client,
      settings: { listPrivacy: "private", style: DEFAULT_CATEGORY_STYLE },
    });

    expect(result.categorized).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].error).toBe("AI API rate limited");
  });

  it("stops processing when aborted via signal", async () => {
    vi.mocked(fetch).mockImplementation(
      graphqlDispatcher({
        starredRepositories: starredRepos([
          { id: "R1", nameWithOwner: "o/r1", description: "desc1" },
          { id: "R2", nameWithOwner: "o/r2", description: "desc2" },
        ]),
        lists: userLists([{ id: "L1", name: "Test", isPrivate: false }]),
        listItems: userListsWithItems([
          {
            id: "L1",
            items: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        ]),
      }),
    );

    const controller = new AbortController();
    const client = mockClient([
      ["o/r1", "Test"],
      ["o/r2", "Test"],
    ]);

    const resultPromise = batchCategorize({
      token: "token",
      client,
      settings: { listPrivacy: "private", style: DEFAULT_CATEGORY_STYLE },
      signal: controller.signal,
    });

    controller.abort();

    const result = await resultPromise;

    expect(result.cancelled).toBe(true);
  });

  it("categorizes multiple repos with one batch AI call", async () => {
    const repoNodes = [
      {
        id: "R1",
        nameWithOwner: "o/r1",
        description: "A CLI tool",
        primaryLanguage: { name: "Rust" },
        repositoryTopics: { nodes: [{ topic: { name: "cli" } }] },
      },
      {
        id: "R2",
        nameWithOwner: "o/r2",
        description: "Another CLI tool",
        primaryLanguage: { name: "Go" },
        repositoryTopics: { nodes: [{ topic: { name: "cli" } }] },
      },
    ];

    vi.mocked(fetch).mockImplementation(
      graphqlDispatcher({
        starredRepositories: starredRepos(repoNodes),
        lists: userLists([]),
        listItems: userListsWithItems([]),
      }),
    );

    const client = mockClient([
      ["o/r1", "CLI Tools"],
      ["o/r2", "CLI Tools"],
    ]);

    const result = await batchCategorize({
      token: "token",
      client,
      settings: { listPrivacy: "private", style: DEFAULT_CATEGORY_STYLE },
    });

    expect(result.categorized).toBe(2);
    expect(result.failed).toBe(0);
    expect(client.categorizeBatch).toHaveBeenCalledTimes(1);
  });
});
