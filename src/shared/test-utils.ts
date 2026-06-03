import { vi, beforeEach, afterEach } from "vitest";

export function setupFetchMock() {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
}

export function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 400,
    status,
    json: async () => data,
    text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
  } as Response;
}

export function mockHttpError(status: number, body = ""): Response {
  return {
    ok: false,
    status,
    text: async () => body,
  } as Response;
}

export function mockGraphqlResponse<T>(data: T): Response {
  return mockJsonResponse({ data });
}

export function mockGraphqlError(
  errors: Array<{ type?: string; message: string }>,
): Response {
  return mockJsonResponse({ data: null, errors });
}

export function graphqlDispatcher(overrides: Record<string, unknown>) {
  const r: Record<string, unknown> = {
    createUserList: {
      createUserList: {
        list: { id: "L_NEW", name: "New", isPrivate: true },
      },
    },
    updateUserListsForItem: {
      updateUserListsForItem: { clientMutationId: null },
    },
    listItems: {
      viewer: { lists: { nodes: [] } },
    },
    lists: {
      viewer: { lists: { nodes: [] } },
    },
    ...overrides,
  };

  return async (...args: unknown[]) => {
    const init = args[1] as RequestInit | undefined;
    const body = JSON.parse((init?.body as string) || "{}");
    const query: string = body.query || "";

    const key = query.includes("createUserList")
      ? "createUserList"
      : query.includes("updateUserListsForItem")
        ? "updateUserListsForItem"
        : query.includes("starredRepositories")
          ? "starredRepositories"
          : query.includes("lists(first:") && query.includes("items(")
            ? "listItems"
            : query.includes("lists(first:")
              ? "lists"
              : null;

    if (key && key in r) {
      return mockGraphqlResponse(r[key]);
    }

    return {
      ok: false,
      status: 500,
      text: async () => `Unmocked GraphQL query: ${query.slice(0, 100)}`,
    } as Response;
  };
}
