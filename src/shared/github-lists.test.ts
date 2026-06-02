import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateToken,
  getViewerLists,
  createUserList,
  getRepoNodeId,
  updateUserListsForItem,
  starRepository,
  fuzzyMatchListName,
  ScopeError,
  getAllListedRepoIds,
  streamUncategorizedRepos,
  batchCategorize,
  type BatchCategorizeResult,
} from "@/shared/github-lists";
import type { AiProviderClient } from "@/shared/providers/base";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockGraphqlResolve<T>(data: T) {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ data }),
  } as Response);
}

function mockGraphqlReject(errors: Array<{ type?: string; message: string }>) {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ data: null, errors }),
  } as Response);
}

function mockFetchFail(status: number, body: string) {
  vi.mocked(fetch).mockResolvedValue({
    ok: false,
    status,
    text: async () => body,
  } as Response);
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

  it("throws ScopeError for FORBIDDEN errors", async () => {
    mockGraphqlReject([{ type: "FORBIDDEN", message: "Access denied" }]);

    await expect(getViewerLists("token")).rejects.toThrow(ScopeError);
  });

  it("throws ScopeError for UNAUTHORIZED errors", async () => {
    mockGraphqlReject([{ type: "UNAUTHORIZED", message: "No access" }]);

    await expect(getViewerLists("token")).rejects.toThrow(ScopeError);
  });

  it("wraps viewer-related errors as ScopeError", async () => {
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

describe("createUserList", () => {
  it("creates a list and returns it", async () => {
    mockGraphqlResolve({
      createUserList: {
        list: { id: "list_1", name: "My Tools", isPrivate: true },
      },
    });

    const list = await createUserList("My Tools", true, "token");

    expect(list).toEqual({ id: "list_1", name: "My Tools", isPrivate: true });
  });
});

describe("getRepoNodeId", () => {
  it("returns the repository node ID", async () => {
    mockGraphqlResolve({
      repository: { id: "R_kgABC123" },
    });

    const id = await getRepoNodeId("owner", "repo", "token");
    expect(id).toBe("R_kgABC123");
  });

  it("throws when the repository is not found", async () => {
    mockGraphqlResolve({ repository: null });

    await expect(getRepoNodeId("owner", "missing", "token")).rejects.toThrow(
      "Repository owner/missing not found",
    );
  });
});

describe("updateUserListsForItem", () => {
  it("sends the correct mutation without error", async () => {
    mockGraphqlResolve({ updateUserListsForItem: { clientMutationId: null } });

    await expect(
      updateUserListsForItem("item_1", ["list_1", "list_2"], "token"),
    ).resolves.toBeUndefined();
  });
});

describe("starRepository", () => {
  it("sends the star mutation without error", async () => {
    mockGraphqlResolve({ addStar: { clientMutationId: null } });

    await expect(
      starRepository("starrable_1", "token"),
    ).resolves.toBeUndefined();
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

describe("ScopeError", () => {
  it("has the correct name and message", () => {
    const err = new ScopeError("test message");
    expect(err.name).toBe("ScopeError");
    expect(err.message).toBe("test message");
    expect(err).toBeInstanceOf(Error);
  });
});

function mockResp(data: unknown): Response {
  return {
    ok: true,
    json: async () => ({ data }),
  } as Response;
}

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
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockClient(results: string[]): AiProviderClient {
    const categorize = vi.fn<AiProviderClient["categorize"]>();
    for (const r of results) {
      categorize.mockResolvedValueOnce(r);
    }
    return { name: "test", categorize };
  }

  it("categorizes uncategorized repos using existing and new lists", async () => {
    vi.mocked(fetch).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) || "{}");
        const query: string = body.query || "";

        if (query.includes("createUserList")) {
          return mockResp({
            createUserList: {
              list: { id: "L2", name: "CLI Tools", isPrivate: true },
            },
          });
        }
        if (query.includes("updateUserListsForItem")) {
          return mockResp({
            updateUserListsForItem: { clientMutationId: null },
          });
        }
        if (query.includes("starredRepositories")) {
          return mockResp({
            viewer: {
              starredRepositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "R1",
                    nameWithOwner: "o/r1",
                    description: "A CLI tool",
                    primaryLanguage: { name: "Rust" },
                    repositoryTopics: {
                      nodes: [{ topic: { name: "cli" } }],
                    },
                  },
                  {
                    id: "R2",
                    nameWithOwner: "o/r2",
                    description: "A React component",
                    primaryLanguage: { name: "TypeScript" },
                    repositoryTopics: {
                      nodes: [{ topic: { name: "react" } }],
                    },
                  },
                ],
              },
            },
          });
        }
        if (query.includes("lists(first:") && query.includes("items(")) {
          return mockResp({
            viewer: {
              lists: {
                nodes: [
                  {
                    id: "L1",
                    items: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
              },
            },
          });
        }
        if (query.includes("lists(first:")) {
          return mockResp({
            viewer: {
              lists: {
                nodes: [{ id: "L1", name: "Frontend", isPrivate: false }],
              },
            },
          });
        }

        return {
          ok: false,
          status: 500,
          text: async () => "Unknown query",
        } as Response;
      },
    );

    const client = mockClient(["CLI Tools", "Frontend"]);
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
    expect(client.categorize).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith(1, "o/r1");
    expect(onProgress).toHaveBeenCalledWith(2, "o/r2");
  });

  it("returns empty result when all repos are already categorized", async () => {
    vi.mocked(fetch).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) || "{}");
        const query: string = body.query || "";

        if (query.includes("createUserList")) {
          return mockResp({
            createUserList: { list: { id: "X", name: "X", isPrivate: true } },
          });
        }
        if (query.includes("updateUserListsForItem")) {
          return mockResp({
            updateUserListsForItem: { clientMutationId: null },
          });
        }
        if (query.includes("starredRepositories")) {
          return mockResp({
            viewer: {
              starredRepositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "R1",
                    nameWithOwner: "o/r1",
                    description: null,
                    primaryLanguage: null,
                    repositoryTopics: { nodes: [] },
                  },
                ],
              },
            },
          });
        }
        if (query.includes("lists(first:") && query.includes("items(")) {
          return mockResp({
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
                ],
              },
            },
          });
        }
        if (query.includes("lists(first:")) {
          return mockResp({
            viewer: {
              lists: {
                nodes: [{ id: "L1", name: "Test", isPrivate: false }],
              },
            },
          });
        }

        return {
          ok: false,
          status: 500,
          text: async () => "Unknown query",
        } as Response;
      },
    );

    const client = mockClient([]);
    const result = await batchCategorize({
      token: "token",
      client,
      settings: { listPrivacy: "private" },
    });

    expect(result.categorized).toBe(0);
    expect(result.failed).toBe(0);
    expect(client.categorize).not.toHaveBeenCalled();
  });

  it("handles partial failure and collects errors", async () => {
    vi.mocked(fetch).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) || "{}");
        const query: string = body.query || "";

        if (query.includes("createUserList")) {
          return mockResp({
            createUserList: { list: { id: "X", name: "X", isPrivate: true } },
          });
        }
        if (query.includes("updateUserListsForItem")) {
          return mockResp({
            updateUserListsForItem: { clientMutationId: null },
          });
        }
        if (query.includes("starredRepositories")) {
          return mockResp({
            viewer: {
              starredRepositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "R1",
                    nameWithOwner: "o/r1",
                    description: "desc1",
                    primaryLanguage: null,
                    repositoryTopics: { nodes: [] },
                  },
                  {
                    id: "R2",
                    nameWithOwner: "o/r2",
                    description: "desc2",
                    primaryLanguage: null,
                    repositoryTopics: { nodes: [] },
                  },
                ],
              },
            },
          });
        }
        if (query.includes("lists(first:") && query.includes("items(")) {
          return mockResp({
            viewer: {
              lists: {
                nodes: [
                  {
                    id: "L1",
                    items: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
              },
            },
          });
        }
        if (query.includes("lists(first:")) {
          return mockResp({
            viewer: {
              lists: { nodes: [{ id: "L1", name: "Test", isPrivate: false }] },
            },
          });
        }

        return {
          ok: false,
          status: 500,
          text: async () => "Unknown query",
        } as Response;
      },
    );

    const client: AiProviderClient = {
      name: "test",
      categorize: vi
        .fn()
        .mockResolvedValueOnce("Test")
        .mockRejectedValueOnce(new Error("AI error")),
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
    expect(result.errors[0].error).toBe("AI error");
  });

  it("stops processing when aborted via signal", async () => {
    vi.mocked(fetch).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) || "{}");
        const query: string = body.query || "";

        if (query.includes("createUserList")) {
          return mockResp({
            createUserList: { list: { id: "X", name: "X", isPrivate: true } },
          });
        }
        if (query.includes("updateUserListsForItem")) {
          return mockResp({
            updateUserListsForItem: { clientMutationId: null },
          });
        }
        if (query.includes("starredRepositories")) {
          return mockResp({
            viewer: {
              starredRepositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "R1",
                    nameWithOwner: "o/r1",
                    description: "desc1",
                    primaryLanguage: null,
                    repositoryTopics: { nodes: [] },
                  },
                  {
                    id: "R2",
                    nameWithOwner: "o/r2",
                    description: "desc2",
                    primaryLanguage: null,
                    repositoryTopics: { nodes: [] },
                  },
                ],
              },
            },
          });
        }
        if (query.includes("lists(first:") && query.includes("items(")) {
          return mockResp({
            viewer: {
              lists: {
                nodes: [
                  {
                    id: "L1",
                    items: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
              },
            },
          });
        }
        if (query.includes("lists(first:")) {
          return mockResp({
            viewer: {
              lists: { nodes: [{ id: "L1", name: "Test", isPrivate: false }] },
            },
          });
        }

        return {
          ok: false,
          status: 500,
          text: async () => "Unknown query",
        } as Response;
      },
    );

    const controller = new AbortController();
    const client = mockClient(["Test", "Test"]);

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

  it("reuses newly created lists for subsequent repos", async () => {
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
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) || "{}");
        const query: string = body.query || "";

        if (query.includes("createUserList")) {
          return mockResp({
            createUserList: {
              list: { id: "L_NEW", name: "CLI Tools", isPrivate: true },
            },
          });
        }
        if (query.includes("updateUserListsForItem")) {
          return mockResp({
            updateUserListsForItem: { clientMutationId: null },
          });
        }
        if (query.includes("starredRepositories")) {
          return mockResp({
            viewer: {
              starredRepositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: repoNodes,
              },
            },
          });
        }
        if (query.includes("lists(first:") && query.includes("items(")) {
          return mockResp({
            viewer: {
              lists: {
                nodes: [],
              },
            },
          });
        }
        if (query.includes("lists(first:")) {
          return mockResp({
            viewer: { lists: { nodes: [] } },
          });
        }

        return {
          ok: false,
          status: 500,
          text: async () => "Unknown query",
        } as Response;
      },
    );

    const client = mockClient(["CLI Tools", "CLI Tools"]);

    await batchCategorize({
      token: "token",
      client,
      settings: { listPrivacy: "private" },
    });

    expect(client.categorize).toHaveBeenCalledTimes(2);
  });
});
