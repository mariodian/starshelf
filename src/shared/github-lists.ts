const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

export const BATCH_SIZE = 5;
const UPDATE_DELAY_MS = 400;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getAllListedRepoIds(token: string): Promise<Set<string>> {
  const repoIds = new Set<string>();

  type ListsData = {
    viewer: {
      lists: {
        nodes: Array<{
          id: string;
          items: {
            nodes: Array<{ id: string } | null>;
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        }>;
      };
    };
  };

  const data = await graphqlRequest<ListsData>(
    token,
    `query {
      viewer {
        lists(first: 100) {
          nodes {
            id
            items(first: ${BATCH_SIZE}) {
              nodes { ... on Repository { id } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    }`,
  );

  for (const list of data.viewer.lists.nodes) {
    for (const node of list.items.nodes) {
      if (node) repoIds.add(node.id);
    }

    let itemCursor = list.items.pageInfo.endCursor;
    let hasMoreItems = list.items.pageInfo.hasNextPage;

    while (hasMoreItems) {
      type ItemPageData = {
        node: {
          items: {
            nodes: Array<{ id: string } | null>;
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        };
      };

      const itemData = await graphqlRequest<ItemPageData>(
        token,
        `query($listId: ID!, $cursor: String) {
          node(id: $listId) {
            ... on UserList {
              items(first: ${BATCH_SIZE}, after: $cursor) {
                nodes { ... on Repository { id } }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }`,
        { listId: list.id, cursor: itemCursor },
      );

      const ip = itemData.node.items;
      for (const node of ip.nodes) {
        if (node) repoIds.add(node.id);
      }
      hasMoreItems = ip.pageInfo.hasNextPage;
      itemCursor = ip.pageInfo.endCursor;
    }
  }

  return repoIds;
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

export interface BatchCategorizeOptions {
  token: string;
  client: import("@/shared/providers/base").AiProviderClient;
  settings: {
    listPrivacy: "public" | "private";
    enableEmojis?: boolean;
    enableCategoryPrefix?: boolean;
    autoFormat?: boolean;
  };
  onProgress?: (current: number, repoName: string) => void;
  signal?: AbortSignal;
}

export interface BatchCategorizeResult {
  categorized: number;
  failed: number;
  cancelled: boolean;
  errors: Array<{ repoName: string; error: string }>;
}

export async function* streamUncategorizedRepos(
  token: string,
  excludeNodeIds?: Set<string>,
): AsyncGenerator<StarredRepoWithLists, void, unknown> {
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    type PageData = {
      viewer: {
        starredRepositories: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<{
            id: string;
            nameWithOwner: string;
            description: string | null;
            primaryLanguage: { name: string } | null;
            repositoryTopics: { nodes: Array<{ topic: { name: string } }> };
          }>;
        };
      };
    };

    const data: PageData = await graphqlRequest<PageData>(
      token,
      `query($cursor: String) {
        viewer {
          starredRepositories(first: ${BATCH_SIZE}, after: $cursor) {
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
      }`,
      cursor ? { cursor } : undefined,
    );

    const repos = data.viewer.starredRepositories;
    hasNextPage = repos.pageInfo.hasNextPage;
    cursor = repos.pageInfo.endCursor;

    for (const node of repos.nodes) {
      if (!excludeNodeIds || !excludeNodeIds.has(node.id)) {
        const [owner, repo] = node.nameWithOwner.split("/");
        yield {
          nodeId: node.id,
          nameWithOwner: node.nameWithOwner,
          owner,
          repo,
          description: node.description || undefined,
          language: node.primaryLanguage?.name || undefined,
          topics: node.repositoryTopics.nodes.map(
            (n: { topic: { name: string } }) => n.topic.name,
          ),
        };
      }
    }
  }
}

export async function batchCategorize(
  options: BatchCategorizeOptions,
): Promise<BatchCategorizeResult> {
  const { token, client, settings, onProgress, signal } = options;

  const lists = await getViewerLists(token);
  const existingNames = lists.map((l) => l.name);

  const listedIds = await getAllListedRepoIds(token);

  let categorized = 0;
  let failed = 0;
  const errors: Array<{ repoName: string; error: string }> = [];

  async function processOne(repo: StarredRepoWithLists): Promise<void> {
    if (signal?.aborted) return;

    try {
      const metadata: import("@/shared/github").RepoMetadata = {
        description: repo.description,
        language: repo.language,
        topics: repo.topics,
      };

      const category = await client.categorize(
        metadata,
        repo.owner,
        repo.repo,
        existingNames,
        settings.enableEmojis,
        settings.enableCategoryPrefix,
        settings.autoFormat,
      );

      let listId: string;
      const matchedList = fuzzyMatchListName(category, lists);
      if (matchedList) {
        listId = matchedList.id;
      } else {
        const isPrivate = settings.listPrivacy === "private";
        const newList = await createUserList(category, isPrivate, token);
        lists.push(newList);
        existingNames.push(newList.name);
        listId = newList.id;
      }

      if (signal?.aborted) return;

      await updateUserListsForItem(repo.nodeId, [listId], token);
      categorized++;
      onProgress?.(categorized, repo.nameWithOwner);
    } catch (err) {
      failed++;
      errors.push({
        repoName: repo.nameWithOwner,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  let batch: StarredRepoWithLists[] = [];

  for await (const repo of streamUncategorizedRepos(token, listedIds)) {
    if (signal?.aborted) break;
    batch.push(repo);
    if (batch.length >= BATCH_SIZE) {
      for (const r of batch) {
        if (signal?.aborted) break;
        await processOne(r);
        if (signal?.aborted) break;
        await delay(UPDATE_DELAY_MS);
      }
      batch = [];
      if (signal?.aborted) break;
    }
  }

  if (!signal?.aborted && batch.length > 0) {
    for (const r of batch) {
      if (signal?.aborted) break;
      await processOne(r);
      if (signal?.aborted) break;
      await delay(UPDATE_DELAY_MS);
    }
  }

  return {
    categorized,
    failed,
    cancelled: signal?.aborted ?? false,
    errors,
  };
}
