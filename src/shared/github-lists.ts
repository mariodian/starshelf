const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

export interface GitHubList {
  id: string;
  name: string;
  isPrivate: boolean;
}

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

async function graphqlRequest<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub GraphQL HTTP ${res.status}: ${text}`);
  }

  const json = await res.json();

  if (json.errors) {
    const err = json.errors[0];
    const type = err.type || "";
    if (type === "FORBIDDEN" || type === "UNAUTHORIZED") {
      throw new ScopeError(
        "Your GitHub token lacks permission to access star lists. Use a classic personal access token with the `user` scope: https://github.com/settings/tokens",
      );
    }
    throw new Error(`GraphQL error: ${err.message}`);
  }

  return json.data as T;
}

export async function validateToken(token: string): Promise<void> {
  await graphqlRequest<{ viewer: { login: string } }>(
    token,
    `query { viewer { login } }`,
  );
}

export async function getViewerLists(token: string): Promise<GitHubList[]> {
  try {
    const data = await graphqlRequest<{
      viewer: {
        lists: {
          nodes: Array<{ id: string; name: string; isPrivate: boolean }>;
        };
      };
    }>(
      token,
      `query {
        viewer {
          lists(first: 100) {
            nodes {
              id
              name
              isPrivate
            }
          }
        }
      }`,
    );
    return data.viewer.lists.nodes;
  } catch (err) {
    if (err instanceof ScopeError) throw err;
    if (err instanceof Error && err.message.includes("viewer")) {
      throw new ScopeError(
        "Your GitHub token cannot access user data. Use a classic personal access token with the `user` scope: https://github.com/settings/tokens",
      );
    }
    throw err;
  }
}

export async function createUserList(
  name: string,
  isPrivate: boolean,
  token: string,
): Promise<GitHubList> {
  const data = await graphqlRequest<{
    createUserList: {
      list: { id: string; name: string; isPrivate: boolean };
    };
  }>(
    token,
    `mutation($input: CreateUserListInput!) {
      createUserList(input: $input) {
        list {
          id
          name
          isPrivate
        }
      }
    }`,
    { input: { name, isPrivate } },
  );
  return data.createUserList.list;
}

export async function getRepoNodeId(
  owner: string,
  repo: string,
  token: string,
): Promise<string> {
  const data = await graphqlRequest<{
    repository: { id: string } | null;
  }>(
    token,
    `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        id
      }
    }`,
    { owner, repo },
  );
  if (!data.repository) {
    throw new Error(`Repository ${owner}/${repo} not found`);
  }
  return data.repository.id;
}

export async function updateUserListsForItem(
  itemId: string,
  listIds: string[],
  token: string,
): Promise<void> {
  await graphqlRequest(
    token,
    `mutation($input: UpdateUserListsForItemInput!) {
      updateUserListsForItem(input: $input) {
        clientMutationId
      }
    }`,
    { input: { itemId, listIds } },
  );
}

export async function starRepository(
  starrableId: string,
  token: string,
): Promise<void> {
  await graphqlRequest(
    token,
    `mutation($input: AddStarInput!) {
      addStar(input: $input) {
        clientMutationId
      }
    }`,
    { input: { starrableId } },
  );
}

export function fuzzyMatchListName(
  category: string,
  lists: GitHubList[],
): GitHubList | null {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .trim();

  const target = norm(category);

  for (const list of lists) {
    if (norm(list.name) === target) return list;
  }

  return null;
}
