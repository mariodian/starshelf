const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

export const GRAPHQL_PAGE_SIZE = 100;

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
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    signal,
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

export async function getViewerLists(
  token: string,
  signal?: AbortSignal,
): Promise<GitHubList[]> {
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
      undefined,
      signal,
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
  signal?: AbortSignal,
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
    signal,
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
  signal?: AbortSignal,
): Promise<void> {
  await graphqlRequest(
    token,
    `mutation($input: UpdateUserListsForItemInput!) {
      updateUserListsForItem(input: $input) {
        clientMutationId
      }
    }`,
    { input: { itemId, listIds } },
    signal,
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

export async function deleteUserList(
  listId: string,
  token: string,
): Promise<void> {
  await graphqlRequest(
    token,
    `mutation($input: DeleteUserListInput!) {
      deleteUserList(input: $input) {
        clientMutationId
      }
    }`,
    { input: { listId } },
  );
}

function normalizeListName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

export function fuzzyMatchListName(
  category: string,
  lists: GitHubList[],
): GitHubList | null {
  const target = normalizeListName(category);
  return lists.find((list) => normalizeListName(list.name) === target) ?? null;
}

/**
 * Lists for one categorization run. Match-or-create and in-flight creates
 * live here, so names() stays in sync without a parallel cache.
 */
export class ListCatalog {
  private readonly lists: GitHubList[];
  private readonly inflight = new Map<string, Promise<GitHubList>>();

  constructor(
    lists: GitHubList[],
    private readonly token: string,
    private readonly listPrivacy: "public" | "private",
  ) {
    this.lists = [...lists];
  }

  static async load(
    token: string,
    listPrivacy: "public" | "private",
    signal?: AbortSignal,
  ): Promise<ListCatalog> {
    return new ListCatalog(
      await getViewerLists(token, signal),
      token,
      listPrivacy,
    );
  }

  names(): string[] {
    return this.lists.map((list) => list.name);
  }

  async assign(
    repoNodeId: string,
    category: string,
    signal?: AbortSignal,
  ): Promise<GitHubList> {
    const key = normalizeListName(category);
    const matched = fuzzyMatchListName(category, this.lists);
    if (matched) {
      await this.addToList(repoNodeId, matched.id, signal);
      return matched;
    }

    let pending = this.inflight.get(key);
    if (!pending) {
      pending = createUserList(
        category,
        this.listPrivacy === "private",
        this.token,
        signal,
      ).then((list) => {
        this.lists.push(list);
        return list;
      });
      this.inflight.set(key, pending);
      pending.finally(() => {
        if (this.inflight.get(key) === pending) this.inflight.delete(key);
      });
    }

    const list = await pending;
    await this.addToList(repoNodeId, list.id, signal);
    return list;
  }

  private async addToList(
    repoNodeId: string,
    listId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) return;
    await updateUserListsForItem(repoNodeId, [listId], this.token, signal);
  }
}

interface ListedRepo {
  repoId: string;
  listId: string;
  listName: string;
}

type ListItems = {
  nodes: Array<{ id: string } | null> | null;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

type ListNode = {
  id: string;
  name: string;
  items: ListItems | null;
} | null;

type ListsData = {
  viewer: {
    lists: {
      nodes: Array<ListNode> | null;
    };
  };
};

type ItemPageData = {
  node: {
    items: ListItems;
  } | null;
};

type ListPageCursor = { id: string; name: string; cursor: string };

function* listedReposOnPage(
  list: { id: string; name: string },
  items: ListItems,
): Generator<ListedRepo, ListPageCursor | null> {
  for (const node of items.nodes ?? []) {
    if (!node) continue;
    yield { repoId: node.id, listId: list.id, listName: list.name };
  }
  const { hasNextPage, endCursor } = items.pageInfo;
  if (!hasNextPage || !endCursor) return null;
  return { id: list.id, name: list.name, cursor: endCursor };
}

async function* streamListedRepos(
  token: string,
  signal?: AbortSignal,
): AsyncGenerator<ListedRepo, void, unknown> {
  const data = await graphqlRequest<ListsData>(
    token,
    `query {
      viewer {
        lists(first: 100) {
          nodes {
            id
            name
            items(first: ${GRAPHQL_PAGE_SIZE}) {
              nodes { ... on Repository { id } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    }`,
    undefined,
    signal,
  );

  let paginating: ListPageCursor[] = [];
  for (const list of data.viewer.lists.nodes ?? []) {
    if (!list?.items) continue;
    const cursor = yield* listedReposOnPage(list, list.items);
    if (cursor) paginating.push(cursor);
  }

  while (paginating.length > 0) {
    if (signal?.aborted) break;

    const results = await Promise.all(
      paginating.map(({ id, cursor }) =>
        graphqlRequest<ItemPageData>(
          token,
          `query($listId: ID!, $cursor: String) {
            node(id: $listId) {
              ... on UserList {
                items(first: ${GRAPHQL_PAGE_SIZE}, after: $cursor) {
                  nodes { ... on Repository { id } }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }
          }`,
          { listId: id, cursor },
          signal,
        ),
      ),
    );

    const next: ListPageCursor[] = [];
    for (let i = 0; i < results.length; i++) {
      const items = results[i].node?.items;
      if (!items) continue;
      const cursor = yield* listedReposOnPage(paginating[i], items);
      if (cursor) next.push(cursor);
    }
    paginating = next;
  }
}

export async function getAllListedRepoIds(
  token: string,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const repoIds = new Set<string>();
  for await (const { repoId } of streamListedRepos(token, signal)) {
    repoIds.add(repoId);
  }
  return repoIds;
}

export interface RepoListMembership {
  listId: string;
  listName: string;
}

export async function getRepoListMap(
  token: string,
  signal?: AbortSignal,
): Promise<Map<string, RepoListMembership>> {
  const memberships = new Map<string, RepoListMembership>();
  for await (const { repoId, listId, listName } of streamListedRepos(
    token,
    signal,
  )) {
    if (!memberships.has(repoId)) memberships.set(repoId, { listId, listName });
  }
  return memberships;
}

export interface StarredRepoWithLists {
  nodeId: string;
  nameWithOwner: string;
  owner: string;
  repo: string;
  description?: string;
  language?: string;
  topics: string[];
}

interface StarredRepoNode {
  id: string;
  nameWithOwner: string;
  description: string | null;
  primaryLanguage: { name: string } | null;
  repositoryTopics: {
    nodes: Array<{ topic: { name: string } | null } | null> | null;
  } | null;
}

interface StarredReposPage {
  viewer: {
    starredRepositories: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<StarredRepoNode | null> | null;
    };
  };
}

const STARRED_REPOS_QUERY = `query($cursor: String) {
  viewer {
    starredRepositories(first: ${GRAPHQL_PAGE_SIZE}, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        nameWithOwner
        description
        primaryLanguage { name }
        repositoryTopics(first: 10) { nodes { topic { name } } }
      }
    }
  }
}`;

function toStarredRepo(node: StarredRepoNode): StarredRepoWithLists {
  const [owner, repo] = node.nameWithOwner.split("/");
  const topics: string[] = [];
  for (const entry of node.repositoryTopics?.nodes ?? []) {
    const name = entry?.topic?.name;
    if (name) topics.push(name);
  }
  return {
    nodeId: node.id,
    nameWithOwner: node.nameWithOwner,
    owner,
    repo,
    description: node.description || undefined,
    language: node.primaryLanguage?.name || undefined,
    topics,
  };
}

export async function* streamAllStarredRepos(
  token: string,
  signal?: AbortSignal,
): AsyncGenerator<StarredRepoWithLists, void, unknown> {
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    if (signal?.aborted) break;

    const data: StarredReposPage = await graphqlRequest<StarredReposPage>(
      token,
      STARRED_REPOS_QUERY,
      cursor ? { cursor } : undefined,
      signal,
    );

    const repos: StarredReposPage["viewer"]["starredRepositories"] =
      data.viewer.starredRepositories;
    hasNextPage = repos.pageInfo.hasNextPage;
    cursor = repos.pageInfo.endCursor;

    for (const node of repos.nodes ?? []) {
      if (!node) continue;
      yield toStarredRepo(node);
    }
  }
}

export async function* streamUncategorizedRepos(
  token: string,
  excludeNodeIds?: Set<string>,
  signal?: AbortSignal,
): AsyncGenerator<StarredRepoWithLists, void, unknown> {
  for await (const repo of streamAllStarredRepos(token, signal)) {
    if (!excludeNodeIds || !excludeNodeIds.has(repo.nodeId)) yield repo;
  }
}
