import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  setupFetchMock,
  mockGraphqlResponse,
  mockGraphqlError,
  mockHttpError,
  graphqlDispatcher,
} from "./test-utils";
import {
  validateToken,
  getViewerLists,
  fuzzyMatchListName,
  ScopeError,
  getAllListedRepoIds,
  streamUncategorizedRepos,
  batchCategorize,
} from "@/shared/github-lists";
import type { AiProviderClient } from "@/shared/providers/base";

setupFetchMock();

function mockGraphqlResolve<T>(data: T) {
  vi.mocked(fetch).mockResolvedValue(mockGraphqlResponse(data));
}

function mockGraphqlReject(errors: Array<{ type?: string; message: string }>) {
  vi.mocked(fetch).mockResolvedValue(mockGraphqlError(errors));
}

function mockFetchFail(status: number, body: string) {
  vi.mocked(fetch).mockResolvedValue(mockHttpError(status, body));
}

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

describe("validateToken", () => {
  it("resolves when the GraphQL query succeeds", async () => {
    mockGraphqlResolve({ viewer: { login: "testuser" } });

    await expect(validateToken("token")).resolves.toBeUndefined();
  });

  it("throws on GraphQL errors", async () => {
    mockGraphqlReject([{ message: "Bad credentials" }]);

    await expect(validateToken("token")).rejects.toThrow("GraphQL error");
  });

  it("throws on HTTP error", async () => {
    mockFetchFail(401, "Unauthorized");

    await expect(validateToken("token")).rejects.toThrow(
      "GitHub GraphQL HTTP 401",
    );
  });
});

describe("getViewerLists", () => {
  it("returns the viewer's lists", async () => {
    mockGraphqlResolve({
      viewer: {
        lists: {
          nodes: [
            { id: "1", name: "Frontend", isPrivate: false },
            { id: "2", name: "CLI Tools", isPrivate: true },
          ],
        },
      },
    });

    const lists = await getViewerLists("token");

    expect(lists).toHaveLength(2);
    expect(lists[0]).toEqual({ id: "1", name: "Frontend", isPrivate: false });
  });

  it("returns empty array for empty list nodes", async () => {
    mockGraphqlResolve({
      viewer: { lists: { nodes: [] } },
    });

    const lists = await getViewerLists("token");
    expect(lists).toEqual([]);
  });

  it.each([
    [{ type: "FORBIDDEN", message: "Access denied" }],
    [{ type: "UNAUTHORIZED", message: "No access" }],
  ])("throws ScopeError for GraphQL %o", async (error) => {
    mockGraphqlReject([error]);
    await expect(getViewerLists("token")).rejects.toThrow(ScopeError);
  });

  it("wraps viewer-related HTTP errors as ScopeError", async () => {
    mockFetchFail(401, "viewer field is not available");
    await expect(getViewerLists("token")).rejects.toThrow(ScopeError);
  });

  it("re-throws non-viewer HTTP errors unchanged", async () => {
    mockFetchFail(500, "Internal server error");
    await expect(getViewerLists("token")).rejects.toThrow(
      "GitHub GraphQL HTTP 500",
    );
  });
});

describe("fuzzyMatchListName", () => {
  const lists = [
    { id: "1", name: "Frontend", isPrivate: false },
    { id: "2", name: "CLI Tools", isPrivate: true },
    { id: "3", name: "Machine Learning", isPrivate: false },
  ];

  it("returns the list with an exact name match", () => {
    expect(fuzzyMatchListName("Frontend", lists)).toEqual(lists[0]);
  });

  it("matches case-insensitively", () => {
    expect(fuzzyMatchListName("frontend", lists)).toEqual(lists[0]);
  });

  it("matches stripping leading and trailing special characters", () => {
    const special = [{ id: "1", name: "-Frontend-", isPrivate: false }];
    expect(fuzzyMatchListName("Frontend", special)).toEqual(special[0]);
  });

  it("matches ignoring special characters in the category", () => {
    expect(fuzzyMatchListName("Front-end!", lists)).toEqual(lists[0]);
  });

  it("normalizes whitespace", () => {
    expect(fuzzyMatchListName("  CLI   Tools  ", lists)).toEqual(lists[1]);
  });

  it("returns null when no match is found", () => {
    expect(fuzzyMatchListName("Backend", lists)).toBeNull();
  });

  it("returns null for an empty list array", () => {
    expect(fuzzyMatchListName("Frontend", [])).toBeNull();
  });

  it("matches unicode letters", () => {
    const unicode = [{ id: "1", name: "Café", isPrivate: false }];
    expect(fuzzyMatchListName("Café", unicode)).toEqual(unicode[0]);
  });
});

describe("getAllListedRepoIds", () => {
  it("returns an empty set when there are no lists", async () => {
    mockGraphqlResolve({
      viewer: {
        lists: {
          nodes: [],
        },
      },
    });

    const ids = await getAllListedRepoIds("token");
    expect(ids.size).toBe(0);
  });

  it("collects repo IDs from list items", async () => {
    mockGraphqlResolve({
      viewer: {
        lists: {
          nodes: [
            {
              id: "L1",
              items: {
                nodes: [{ id: "R1" }, { id: "R2" }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          ],
        },
      },
    });

    const ids = await getAllListedRepoIds("token");
    expect(ids.size).toBe(2);
    expect(ids.has("R1")).toBe(true);
    expect(ids.has("R2")).toBe(true);
  });

  it("follows pagination within list items", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            viewer: {
              lists: {
                nodes: [
                  {
                    id: "L1",
                    items: {
                      nodes: [{ id: "R1" }],
                      pageInfo: { hasNextPage: true, endCursor: "c1" },
                    },
                  },
                ],
              },
            },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            node: {
              items: {
                nodes: [{ id: "R2" }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      } as Response);

    const ids = await getAllListedRepoIds("token");
    expect(ids.size).toBe(2);
    expect(ids.has("R1")).toBe(true);
    expect(ids.has("R2")).toBe(true);
  });

  it("paginates multiple lists concurrently", async () => {
    vi.mocked(fetch).mockImplementation(async (...args: unknown[]) => {
      const init = args[1] as RequestInit | undefined;
      const body = JSON.parse(init?.body as string) as {
        variables?: Record<string, unknown>;
      };
      const { variables } = body;

      if (!variables?.listId) {
        return mockGraphqlResponse({
          viewer: {
            lists: {
              nodes: [
                {
                  id: "L1",
                  items: {
                    nodes: [{ id: "R1a" }],
                    pageInfo: { hasNextPage: true, endCursor: "c1" },
                  },
                },
                {
                  id: "L2",
                  items: {
                    nodes: [{ id: "R2a" }],
                    pageInfo: { hasNextPage: true, endCursor: "c2" },
                  },
                },
              ],
            },
          },
        });
      }

      const listId = variables.listId as string;
      if (listId === "L1") {
        return mockGraphqlResponse({
          node: {
            items: {
              nodes: [{ id: "R1b" }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
      if (listId === "L2") {
        return mockGraphqlResponse({
          node: {
            items: {
              nodes: [{ id: "R2b" }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
      return mockGraphqlResponse({});
    });

    const ids = await getAllListedRepoIds("token");
    expect(ids.size).toBe(4);
    expect(ids.has("R1a")).toBe(true);
    expect(ids.has("R2a")).toBe(true);
    expect(ids.has("R1b")).toBe(true);
    expect(ids.has("R2b")).toBe(true);
  });

  it("skips null items in the nodes array", async () => {
    mockGraphqlResolve({
      viewer: {
        lists: {
          nodes: [
            {
              id: "L1",
              items: {
                nodes: [{ id: "R1" }, null, { id: "R2" }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          ],
        },
      },
    });

    const ids = await getAllListedRepoIds("token");
    expect(ids.size).toBe(2);
  });

  it("deduplicates repos across multiple lists", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            lists: {
              nodes: [
                {
                  id: "L1",
                  items: {
                    nodes: [{ id: "R1" }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
                {
                  id: "L2",
                  items: {
                    nodes: [{ id: "R1" }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              ],
            },
          },
        },
      }),
    } as Response);

    const ids = await getAllListedRepoIds("token");
    expect(ids.size).toBe(1);
  });
});

describe("streamUncategorizedRepos", () => {
  it("yields only uncategorized repos", async () => {
    mockGraphqlResolve({
      viewer: {
        starredRepositories: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "R_1",
              nameWithOwner: "owner/repo1",
              description: "A test repo",
              primaryLanguage: { name: "TypeScript" },
              repositoryTopics: {
                nodes: [{ topic: { name: "cli" } }],
              },
            },
            {
              id: "R_2",
              nameWithOwner: "owner/repo2",
              description: "Already categorized",
              primaryLanguage: null,
              repositoryTopics: { nodes: [] },
            },
          ],
        },
      },
    });

    const excludeNodeIds = new Set<string>(["R_2"]);

    const results = [];
    for await (const repo of streamUncategorizedRepos(
      "token",
      excludeNodeIds,
    )) {
      results.push(repo);
    }

    expect(results).toHaveLength(1);
    expect(results[0].nodeId).toBe("R_1");
    expect(results[0].nameWithOwner).toBe("owner/repo1");
    expect(results[0].owner).toBe("owner");
    expect(results[0].repo).toBe("repo1");
    expect(results[0].description).toBe("A test repo");
    expect(results[0].language).toBe("TypeScript");
    expect(results[0].topics).toEqual(["cli"]);
  });

  it("follows pagination across multiple pages", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            viewer: {
              starredRepositories: {
                pageInfo: { hasNextPage: true, endCursor: "cursor1" },
                nodes: [
                  {
                    id: "R_1",
                    nameWithOwner: "o/r1",
                    description: null,
                    primaryLanguage: null,
                    repositoryTopics: { nodes: [] },
                  },
                ],
              },
            },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            viewer: {
              starredRepositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "R_2",
                    nameWithOwner: "o/r2",
                    description: null,
                    primaryLanguage: null,
                    repositoryTopics: { nodes: [] },
                  },
                ],
              },
            },
          },
        }),
      } as Response);

    const results = [];
    for await (const repo of streamUncategorizedRepos("token")) {
      results.push(repo);
    }

    expect(results).toHaveLength(2);
    expect(results[0].nodeId).toBe("R_1");
    expect(results[1].nodeId).toBe("R_2");
  });

  it("returns nothing when all repos are categorized", async () => {
    mockGraphqlResolve({
      viewer: {
        starredRepositories: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "R_1",
              nameWithOwner: "o/r1",
              description: null,
              primaryLanguage: null,
              repositoryTopics: { nodes: [] },
            },
          ],
        },
      },
    });

    const excludeNodeIds = new Set<string>(["R_1"]);

    const results = [];
    for await (const repo of streamUncategorizedRepos(
      "token",
      excludeNodeIds,
    )) {
      results.push(repo);
    }

    expect(results).toEqual([]);
  });
});

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
      settings: { listPrivacy: "private" },
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
      settings: { listPrivacy: "private" },
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
      settings: { listPrivacy: "private" },
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
      settings: { listPrivacy: "private" },
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
      settings: { listPrivacy: "private" },
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
      settings: { listPrivacy: "private" },
    });

    expect(result.categorized).toBe(2);
    expect(result.failed).toBe(0);
    expect(client.categorizeBatch).toHaveBeenCalledTimes(1);
  });
});
