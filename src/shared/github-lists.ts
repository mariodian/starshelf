const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

export const GRAPHQL_PAGE_SIZE = 100;
export const AI_BATCH_SIZE = 10;
export const CONCURRENCY_LIMIT = 10;
export const UPDATE_DELAY_MS = 50;

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

export function normalizeListName(name: string): string {
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

  for (const list of lists) {
    if (normalizeListName(list.name) === target) return list;
  }

  return null;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

class Semaphore {
  private tasks: (() => void)[] = [];
  private count = 0;

  constructor(private max: number) {}

  acquire(): Promise<void> {
    if (this.count < this.max) {
      this.count++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.tasks.push(resolve);
    });
  }

  release(): void {
    if (this.tasks.length > 0) {
      this.tasks.shift()!();
    } else {
      this.count--;
    }
  }
}

export async function getAllListedRepoIds(
  token: string,
  signal?: AbortSignal,
): Promise<Set<string>> {
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

  type ItemPageData = {
    node: {
      items: {
        nodes: Array<{ id: string } | null>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
  };

  for (const list of data.viewer.lists.nodes) {
    for (const node of list.items.nodes) {
      if (node) repoIds.add(node.id);
    }
  }

  let paginating = data.viewer.lists.nodes
    .filter((l) => l.items.pageInfo.hasNextPage)
    .map((l) => ({ id: l.id, cursor: l.items.pageInfo.endCursor! }));

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

    const next: typeof paginating = [];
    for (let i = 0; i < results.length; i++) {
      const ip = results[i].node.items;
      for (const node of ip.nodes) {
        if (node) repoIds.add(node.id);
      }
      if (ip.pageInfo.hasNextPage && ip.pageInfo.endCursor) {
        next.push({ id: paginating[i].id, cursor: ip.pageInfo.endCursor });
      }
    }
    paginating = next;
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
  onProgress?: (
    current: number,
    repoName: string,
    message?: string,
  ) => Promise<void> | void;
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
  signal?: AbortSignal,
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
      }`,
      cursor ? { cursor } : undefined,
      signal,
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

  let categorized = 0;
  let failed = 0;
  const errors: Array<{ repoName: string; error: string }> = [];

  try {
    await onProgress?.(0, "", "Fetching your lists...");
    const lists = await getViewerLists(token, signal);
    const existingNames = lists.map((l) => l.name);

    const normalizedLists = new Map<string, GitHubList>();
    for (const list of lists) {
      normalizedLists.set(normalizeListName(list.name), list);
    }

    const listedIds =
      lists.length > 0
        ? await (async () => {
            await onProgress?.(0, "", "Scanning your starred repositories...");
            return getAllListedRepoIds(token, signal);
          })()
        : new Set<string>();

    const semaphore = new Semaphore(CONCURRENCY_LIMIT);

    async function processRepoMutations(
      repo: StarredRepoWithLists,
      category: string,
    ): Promise<void> {
      let listId: string;
      const normName = normalizeListName(category);
      const matchedList = normalizedLists.get(normName);

      if (matchedList) {
        listId = matchedList.id;
      } else {
        const isPrivate = settings.listPrivacy === "private";
        const newList = await createUserList(
          category,
          isPrivate,
          token,
          signal,
        );
        lists.push(newList);
        existingNames.push(newList.name);
        normalizedLists.set(normalizeListName(newList.name), newList);
        listId = newList.id;
      }

      if (signal?.aborted) return;

      await updateUserListsForItem(repo.nodeId, [listId], token, signal);
      categorized++;
      await onProgress?.(categorized, repo.nameWithOwner);
    }

    async function processChunk(repos: StarredRepoWithLists[]): Promise<void> {
      if (signal?.aborted) return;

      try {
        const batchRepos = repos.map((r) => ({
          nameWithOwner: r.nameWithOwner,
          owner: r.owner,
          repo: r.repo,
          metadata: {
            description: r.description,
            language: r.language,
            topics: r.topics,
          } as import("@/shared/github").RepoMetadata,
        }));

        await onProgress?.(
          categorized + failed,
          repos[0].nameWithOwner,
          "Analyzing with AI...",
        );

        const catMap = await client.categorizeBatch(
          batchRepos,
          existingNames,
          settings.enableEmojis,
          settings.enableCategoryPrefix,
          settings.autoFormat,
          undefined,
          signal,
        );

        const tasks = repos.map(async (repo) => {
          if (signal?.aborted) return;

          const category = catMap.get(repo.nameWithOwner);
          if (!category) {
            failed++;
            errors.push({
              repoName: repo.nameWithOwner,
              error: "No category returned for repo",
            });
            await onProgress?.(categorized + failed, repo.nameWithOwner);
            return;
          }

          await semaphore.acquire();
          try {
            if (signal?.aborted) return;

            await processRepoMutations(repo, category);
            await delay(UPDATE_DELAY_MS, signal);
          } catch (err) {
            failed++;
            errors.push({
              repoName: repo.nameWithOwner,
              error: err instanceof Error ? err.message : "Unknown error",
            });
            await onProgress?.(categorized + failed, repo.nameWithOwner);
          } finally {
            semaphore.release();
          }
        });

        await Promise.all(tasks);
      } catch (err) {
        for (const repo of repos) {
          failed++;
          errors.push({
            repoName: repo.nameWithOwner,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
        await onProgress?.(
          categorized + failed,
          repos[repos.length - 1].nameWithOwner,
        );
      }
    }

    let chunk: StarredRepoWithLists[] = [];
    let repoCount = 0;

    await onProgress?.(0, "", "Looking for uncategorized repositories...");

    for await (const repo of streamUncategorizedRepos(
      token,
      listedIds,
      signal,
    )) {
      if (signal?.aborted) break;
      repoCount++;
      chunk.push(repo);
      if (chunk.length >= AI_BATCH_SIZE) {
        await processChunk(chunk);
        chunk = [];
        if (signal?.aborted) break;
      }
    }

    if (!signal?.aborted && chunk.length > 0) {
      await processChunk(chunk);
    }

    if (repoCount === 0) {
      await onProgress?.(
        0,
        "",
        "Nothing to categorize — all repositories already have a list",
      );
    }

    return {
      categorized,
      failed,
      cancelled: signal?.aborted ?? false,
      errors,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { categorized, failed, cancelled: true, errors };
    }
    throw err;
  }
}
