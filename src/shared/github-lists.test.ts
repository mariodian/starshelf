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
} from "@/shared/github-lists";

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
