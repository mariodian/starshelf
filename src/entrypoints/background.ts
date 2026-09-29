import type {
  ContentMessage,
  UpdateStarStatusMessage,
  RuntimeMessage,
  BatchStatus,
  BatchProgressMessage,
  SyncStatus,
  SyncProgressMessage,
} from "@/shared/types/messages";
import {
  storage,
  type ExtensionSettings,
  type RepoRecord,
} from "@/shared/storage";
import {
  fetchRepoMetadata,
  isRepoPage,
  type RepoMetadata,
} from "@/shared/github";
import {
  validateToken,
  getRepoNodeId,
  updateUserListsForItem,
  starRepository,
  streamAllStarredRepos,
  getRepoListMap,
  GRAPHQL_PAGE_SIZE,
  ListCatalog,
} from "@/shared/github-lists";
import { batchCategorize } from "@/shared/batch-categorize";
import { categoryStyle, type AiProviderClient } from "@/shared/providers/base";
import { createProviderClient } from "@/shared/providers/factory";
import { logger } from "@/shared/logger";

export default defineBackground(() => {
  if (import.meta.env.DEV) {
    import("@/shared/dev-bootstrap").then((m) => m.seedFromEnvIfMissing());
  }

  browser.runtime.onMessage.addListener((message: RuntimeMessage, sender) => {
    if (message.type === "repoStarClicked") {
      logger.log(
        "[stars] bg received | action:",
        message.payload.action,
        "| repo:",
        message.payload.owner + "/" + message.payload.repo,
      );
      handleStarClick(message.payload, sender.tab?.id, sender.tab?.url);
    } else if (message.type === "regenerateCategory") {
      logger.log(
        "[regenerate] bg received | repo:",
        message.payload.owner + "/" + message.payload.repo,
        "| rejections:",
        message.payload.previousCategories,
        "| current:",
        message.payload.currentCategory,
      );
      handleRegenerate(message.payload, sender.tab?.id);
    } else if (message.type === "startBatch") {
      return batchJob.start();
    } else if (message.type === "cancelBatch") {
      return batchJob.cancel();
    } else if (message.type === "syncRepos") {
      return syncJob.start();
    } else if (message.type === "cancelSync") {
      return syncJob.cancel();
    }
  });
});

const inFlight = new Set<string>();

const TOKEN_REQUIRED =
  "GitHub token is required. Add it in the extension popup.";
const PROVIDER_REQUIRED =
  "No AI provider configured. Open the extension popup.";

type ReadyContext = {
  settings: ExtensionSettings;
  token: string;
  client: AiProviderClient;
};

async function requireToken(): Promise<
  { settings: ExtensionSettings; token: string } | { error: string }
> {
  const settings = await storage.getSettings();
  const token = settings.githubToken;
  if (!token) return { error: TOKEN_REQUIRED };
  return { settings, token };
}

async function requireReady(): Promise<ReadyContext | { error: string }> {
  const ready = await requireToken();
  if ("error" in ready) return ready;

  const client = createProviderClient(
    ready.settings.activeProvider,
    ready.settings.providers,
  );
  if (!client) return { error: PROVIDER_REQUIRED };

  return { ...ready, client };
}

async function categorizeAndAssign(
  tabId: number,
  owner: string,
  repo: string,
  settings: ExtensionSettings,
  client: AiProviderClient,
  repoNodeId: string,
  metadata: RepoMetadata,
  catalog: ListCatalog,
  previousCategories?: string[],
): Promise<{
  category: string;
  listId: string;
  listName: string;
}> {
  const category = await client.categorize({
    metadata,
    owner,
    repo,
    existingLists: catalog.names(),
    style: categoryStyle(settings),
    previousCategories: previousCategories ?? [],
  });
  logger.log("[stars] bg | AI result:", category);

  const list = await catalog.assign(repoNodeId, category);
  logger.log("[stars] bg | assigned list:", list.name);

  await sendStatus(tabId, owner, repo, "saved", list.name);
  return {
    category,
    listId: list.id,
    listName: list.name,
  };
}

async function handleStarClick(
  payload: { owner: string; repo: string; action: "star" | "unstar" },
  tabId?: number,
  tabUrl?: string,
) {
  if (!tabId) return;
  if (!tabUrl || !isRepoPage(tabUrl)) return;

  const { owner, repo, action } = payload;
  const fullName = `${owner}/${repo}`;

  if (inFlight.has(fullName)) return;
  inFlight.add(fullName);

  try {
    // Unstar — just clear local cache, no API calls needed.
    // GitHub handles removing the repo from any lists on unstar.
    if (action === "unstar") {
      const settings = await storage.getSettings();
      if (!settings.githubToken) {
        await sendStatus(
          tabId,
          owner,
          repo,
          "error",
          undefined,
          TOKEN_REQUIRED,
        );
        return;
      }
      logger.log("[stars] bg unstar branch | fullName:", fullName);
      await storage.removeRepo(fullName);
      await sendStatus(tabId, owner, repo, "removed");
      return;
    }

    const ready = await requireReady();
    if ("error" in ready) {
      await sendStatus(tabId, owner, repo, "error", undefined, ready.error);
      return;
    }

    // Star
    await sendStatus(tabId, owner, repo, "categorizing");

    logger.log("[stars] bg | validating token...");
    await validateToken(ready.token);
    logger.log("[stars] bg | token valid");

    logger.log("[stars] bg | fetchRepoMetadata...");
    const metadata = await fetchRepoMetadata(owner, repo, ready.token);
    logger.log(
      "[stars] bg | metadata:",
      metadata.language,
      metadata.topics?.length,
      "topics",
    );

    const catalog = await ListCatalog.load(
      ready.token,
      ready.settings.listPrivacy,
    );
    logger.log("[stars] bg | lists:", catalog.names().length);

    logger.log("[stars] bg | getRepoNodeId...");
    const repoNodeId = await getRepoNodeId(owner, repo, ready.token);
    logger.log("[stars] bg | starRepository...");
    await starRepository(repoNodeId, ready.token);

    logger.log(
      "[stars] bg | AI categorize | provider:",
      ready.settings.activeProvider,
      "| model:",
      ready.settings.providers[ready.settings.activeProvider]?.model,
    );
    const result = await categorizeAndAssign(
      tabId,
      owner,
      repo,
      ready.settings,
      ready.client,
      repoNodeId,
      metadata,
      catalog,
    );
    const now = new Date().toISOString();
    await storage.saveRepo({
      owner,
      repo,
      fullName,
      nodeId: repoNodeId,
      description: metadata.description,
      language: metadata.language,
      topics: metadata.topics,
      listId: result.listId,
      listName: result.listName,
      starredAt: now,
      updatedAt: now,
    });
  } catch (err) {
    logger.error("[stars] bg | failed:", err);
    const msg = err instanceof Error ? err.message : "Unexpected error";
    await sendStatus(tabId, owner, repo, "error", undefined, msg);
  } finally {
    inFlight.delete(fullName);
  }
}

async function handleRegenerate(
  payload: {
    owner: string;
    repo: string;
    previousCategories: string[];
    currentCategory: string;
  },
  tabId?: number,
) {
  if (!tabId) return;

  const { owner, repo, previousCategories, currentCategory } = payload;
  const fullName = `${owner}/${repo}`;

  if (inFlight.has(fullName)) return;
  inFlight.add(fullName);

  try {
    const repos = await storage.getRepos();
    const record = repos[fullName];
    if (!record) {
      await sendStatus(
        tabId,
        owner,
        repo,
        "error",
        undefined,
        "Star this repo again so Starshelf can regenerate it.",
      );
      return;
    }

    const ready = await requireReady();
    if ("error" in ready) {
      await sendStatus(tabId, owner, repo, "error", undefined, ready.error);
      return;
    }

    await sendStatus(tabId, owner, repo, "categorizing");

    logger.log("[regenerate] bg | removing from list:", record.listName);
    await updateUserListsForItem(record.nodeId, [], ready.token);

    const catalog = await ListCatalog.load(
      ready.token,
      ready.settings.listPrivacy,
    );

    const allRejected = [currentCategory, ...previousCategories];
    logger.log("[regenerate] bg | AI categorize | rejected:", allRejected);

    const metadata: RepoMetadata = {
      description: record.description,
      language: record.language,
      topics: record.topics,
    };
    const result = await categorizeAndAssign(
      tabId,
      owner,
      repo,
      ready.settings,
      ready.client,
      record.nodeId,
      metadata,
      catalog,
      allRejected,
    );
    await storage.saveRepo({
      ...record,
      listId: result.listId,
      listName: result.listName,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("[regenerate] bg | failed:", err);
    const msg = err instanceof Error ? err.message : "Unexpected error";
    await sendStatus(tabId, owner, repo, "error", undefined, msg);
  } finally {
    inFlight.delete(fullName);
  }
}

async function sendStatus(
  tabId: number,
  owner: string,
  repo: string,
  status: UpdateStarStatusMessage["payload"]["status"],
  category?: string,
  error?: string,
) {
  const message: UpdateStarStatusMessage = {
    type: "updateStarStatus",
    payload: { owner, repo, status, category, error },
  };
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch {
    // Tab may have been closed
  }
}

type JobReply = { alreadyRunning: true } | { error: string } | null;
type CancelReply = { success: true } | { notRunning: true };

function createJob(config: {
  isRunning: () => Promise<boolean>;
  run: (signal: AbortSignal) => Promise<{ error: string } | void>;
}): { start: () => Promise<JobReply>; cancel: () => Promise<CancelReply> } {
  let abortController: AbortController | null = null;

  return {
    async start() {
      if (abortController || (await config.isRunning())) {
        return { alreadyRunning: true };
      }

      const controller = new AbortController();
      abortController = controller;
      try {
        const reply = await config.run(controller.signal);
        return reply ?? null;
      } finally {
        if (abortController === controller) abortController = null;
      }
    },
    async cancel() {
      if (!abortController) return { notRunning: true };
      abortController.abort();
      return { success: true };
    },
  };
}

async function publishBatch(status: BatchStatus): Promise<void> {
  await browser.storage.session.set({ batchStatus: status });
  try {
    const message: BatchProgressMessage = {
      type: "batchProgress",
      payload: status,
    };
    await browser.runtime.sendMessage(message);
  } catch {
    // Popup may not be open
  }
}

async function publishSync(status: SyncStatus): Promise<void> {
  await browser.storage.session.set({ syncStatus: status });
  try {
    const message: SyncProgressMessage = {
      type: "syncProgress",
      payload: status,
    };
    await browser.runtime.sendMessage(message);
  } catch {
    // Popup may not be open
  }
}

async function sessionIsRunning(
  key: "batchStatus" | "syncStatus",
): Promise<boolean> {
  const stored = await browser.storage.session.get(key);
  const status = stored[key] as { state?: string } | undefined;
  return status?.state === "running";
}

const batchJob = createJob({
  isRunning: () => sessionIsRunning("batchStatus"),
  run: async (signal) => {
    const ready = await requireReady();
    if ("error" in ready) return ready;

    await publishBatch({
      state: "running",
      current: 0,
      currentRepo: "",
    });

    try {
      const result = await batchCategorize({
        token: ready.token,
        client: ready.client,
        settings: {
          listPrivacy: ready.settings.listPrivacy,
          style: categoryStyle(ready.settings),
        },
        signal,
        onProgress: async (current, repoName, message) => {
          await publishBatch({
            state: "running",
            current,
            currentRepo: repoName,
            message,
          });
        },
      });

      await publishBatch(
        result.cancelled
          ? {
              state: "cancelled",
              categorized: result.categorized,
              skipped: result.failed,
              completedAt: new Date().toISOString(),
            }
          : {
              state: "done",
              categorized: result.categorized,
              skipped: result.failed,
              completedAt: new Date().toISOString(),
            },
      );
    } catch (err) {
      await publishBatch({
        state: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
      logger.error("[batch] bg | batchCategorize failed:", err);
    }
  },
});

const syncJob = createJob({
  isRunning: () => sessionIsRunning("syncStatus"),
  run: async (signal) => {
    const ready = await requireToken();
    if ("error" in ready) return ready;

    await publishSync({ state: "running", synced: 0 });

    let synced = 0;
    const pending: RepoRecord[] = [];
    const flushPending = async () => {
      if (pending.length === 0) return;
      const page = pending.slice();
      await storage.saveRepos(page);
      pending.length = 0;
    };

    try {
      await publishSync({
        state: "running",
        synced: 0,
        message: "Fetching repo lists...",
      });
      const listMap = await getRepoListMap(ready.token, signal);
      const existing = await storage.getRepos();

      for await (const repo of streamAllStarredRepos(ready.token, signal)) {
        if (signal.aborted) break;

        const membership = listMap.get(repo.nodeId);
        const now = new Date().toISOString();
        pending.push({
          owner: repo.owner,
          repo: repo.repo,
          fullName: repo.nameWithOwner,
          nodeId: repo.nodeId,
          description: repo.description,
          language: repo.language,
          topics: repo.topics,
          listId: membership?.listId,
          listName: membership?.listName,
          starredAt: existing[repo.nameWithOwner]?.starredAt ?? now,
          updatedAt: now,
        });

        synced++;
        await publishSync({
          state: "running",
          synced,
          message: `Syncing ${repo.nameWithOwner}...`,
        });

        if (pending.length >= GRAPHQL_PAGE_SIZE) {
          await flushPending();
        }
      }

      await flushPending();

      await publishSync(
        signal.aborted
          ? {
              state: "cancelled",
              synced,
              completedAt: new Date().toISOString(),
            }
          : {
              state: "done",
              synced,
              completedAt: new Date().toISOString(),
            },
      );
    } catch (err) {
      try {
        await flushPending();
      } catch (flushErr) {
        logger.error("[sync] bg | flush failed:", flushErr);
      }

      if (
        signal.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        await publishSync({
          state: "cancelled",
          synced,
          completedAt: new Date().toISOString(),
        });
      } else {
        await publishSync({
          state: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
        logger.error("[sync] bg | syncRepos failed:", err);
      }
    }
  },
});
