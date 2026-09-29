import type { RepoMetadata } from "@/shared/github";
import {
  getAllListedRepoIds,
  ListCatalog,
  streamUncategorizedRepos,
  type StarredRepoWithLists,
} from "@/shared/github-lists";
import type { AiProviderClient, CategoryStyle } from "@/shared/providers/base";

const AI_BATCH_SIZE = 10;
const CONCURRENCY_LIMIT = 10;
const UPDATE_DELAY_MS = 50;

export interface BatchCategorizeOptions {
  token: string;
  client: AiProviderClient;
  settings: {
    listPrivacy: "public" | "private";
    style: CategoryStyle;
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

export async function batchCategorize(
  options: BatchCategorizeOptions,
): Promise<BatchCategorizeResult> {
  const { token, client, settings, onProgress, signal } = options;

  let categorized = 0;
  let failed = 0;
  const errors: Array<{ repoName: string; error: string }> = [];

  try {
    await onProgress?.(0, "", "Fetching your lists...");
    const catalog = await ListCatalog.load(token, settings.listPrivacy, signal);

    let listedIds = new Set<string>();
    if (catalog.names().length > 0) {
      await onProgress?.(0, "", "Scanning your starred repositories...");
      listedIds = await getAllListedRepoIds(token, signal);
    }

    const semaphore = new Semaphore(CONCURRENCY_LIMIT);

    async function processRepoMutations(
      repo: StarredRepoWithLists,
      category: string,
    ): Promise<void> {
      await catalog.assign(repo.nodeId, category, signal);

      if (signal?.aborted) return;

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
          } as RepoMetadata,
        }));

        await onProgress?.(
          categorized + failed,
          repos[0].nameWithOwner,
          "Analyzing with AI...",
        );

        const catMap = await client.categorizeBatch({
          repos: batchRepos,
          existingLists: catalog.names(),
          style: settings.style,
          signal,
        });

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
