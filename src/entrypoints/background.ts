import type {
  ContentMessage,
  UpdateStarStatusMessage,
  RuntimeMessage,
  BatchStatus,
  BatchProgressMessage,
  SyncStatus,
  SyncProgressMessage,
} from "@/shared/types/messages";
import { storage, type ExtensionSettings } from "@/shared/storage";
import {
  fetchRepoMetadata,
  isRepoPage,
  type RepoMetadata,
} from "@/shared/github";
import {
  validateToken,
  getViewerLists,
  getRepoNodeId,
  updateUserListsForItem,
  starRepository,
  streamAllStarredRepos,
  getRepoListMap,
  assignRepoToList,
  type GitHubList,
} from "@/shared/github-lists";
import { batchCategorize } from "@/shared/batch-categorize";
import type { AiProviderClient } from "@/shared/providers/base";
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
      return handleStartBatch();
    } else if (message.type === "cancelBatch") {
      return handleCancelBatch();
    } else if (message.type === "syncRepos") {
      return handleSyncRepos();
    } else if (message.type === "cancelSync") {
      return handleCancelSync();
    }
  });
});

const inFlight = new Set<string>();

async function withErrorHandling<T>(
  operation: () => Promise<T>,
  tabId: number,
  owner: string,
  repo: string,
  context: string,
  logPrefix: string,
): Promise<T | null> {
  try {
    return await operation();
  } catch (err) {
    logger.error(`${logPrefix} | ${context} FAILED:`, err);
    const msg = err instanceof Error ? err.message : `${context} failed`;
    await sendStatus(tabId, owner, repo, "error", undefined, msg);
    return null;
  }
}

async function categorizeAndAssign(
  tabId: number,
  owner: string,
  repo: string,
  token: string,
  settings: ExtensionSettings,
  client: AiProviderClient,
  repoNodeId: string,
  metadata: RepoMetadata,
  lists: GitHubList[],
  previousCategories?: string[],
): Promise<{
  category: string;
  listId: string;
  listName: string;
} | null> {
  const existingNames = lists.map((l) => l.name);

  const category = await withErrorHandling(
    async () => {
      const cat = await client.categorize({
        metadata,
        owner,
        repo,
        existingLists: existingNames,
        style: {
          enableEmojis: settings.enableEmojis,
          enableCategoryPrefix: settings.enableCategoryPrefix,
          autoFormat: settings.autoFormat,
        },
        previousCategories: previousCategories ?? [],
      });
      logger.log("[stars] bg | AI result:", cat);
      return cat;
    },
    tabId,
    owner,
    repo,
    "AI categorize",
    "[stars] bg",
  );
  if (category === null) return null;

  const assigned = await withErrorHandling(
    async () => {
      const result = await assignRepoToList(repoNodeId, category, {
        token,
        listPrivacy: settings.listPrivacy,
        lists,
      });
      logger.log(
        "[stars] bg | assignRepoToList:",
        result.created ? "created" : "matched",
        result.list.name,
      );
      return result;
    },
    tabId,
    owner,
    repo,
    "assign to list",
    "[stars] bg",
  );
  if (assigned === null) return null;

  await sendStatus(tabId, owner, repo, "saved", assigned.list.name);
  return {
    category,
    listId: assigned.list.id,
    listName: assigned.list.name,
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
    const settings = await storage.getSettings();
    const token = settings.githubToken;

    if (!token) {
      await sendStatus(
        tabId,
        owner,
        repo,
        "error",
        undefined,
        "GitHub token is required. Add it in the extension popup.",
      );
      return;
    }

    // Unstar — just clear local cache, no API calls needed.
    // GitHub handles removing the repo from any lists on unstar.
    if (action === "unstar") {
      logger.log("[stars] bg unstar branch | fullName:", fullName);
      await storage.removeRepo(fullName);
      await sendStatus(tabId, owner, repo, "removed");
      return;
    }

    // Star
    await sendStatus(tabId, owner, repo, "categorizing");

    // Validate token scope
    const tokenOk = await withErrorHandling(
      async () => {
        logger.log("[stars] bg | validating token...");
        await validateToken(token);
        logger.log("[stars] bg | token valid");
        return true;
      },
      tabId,
      owner,
      repo,
      "token validation",
      "[stars] bg",
    );
    if (tokenOk === null) return;

    // Fetch repo metadata
    const metadata = await withErrorHandling(
      async () => {
        logger.log("[stars] bg | fetchRepoMetadata...");
        const meta = await fetchRepoMetadata(owner, repo, token);
        logger.log(
          "[stars] bg | metadata:",
          meta.language,
          meta.topics?.length,
          "topics",
        );
        return meta;
      },
      tabId,
      owner,
      repo,
      "fetchRepoMetadata",
      "[stars] bg",
    );
    if (metadata === null) return;

    // Get viewer lists
    const lists = await withErrorHandling(
      async () => {
        logger.log("[stars] bg | getViewerLists...");
        const result = await getViewerLists(token);
        logger.log("[stars] bg | lists:", result.length);
        return result;
      },
      tabId,
      owner,
      repo,
      "getViewerLists",
      "[stars] bg",
    );
    if (lists === null) return;

    const client = createProviderClient(
      settings.activeProvider,
      settings.providers[settings.activeProvider],
    );
    if (!client) {
      await sendStatus(
        tabId,
        owner,
        repo,
        "error",
        undefined,
        "No AI provider configured. Open the extension popup.",
      );
      return;
    }

    // Resolve repo node ID and ensure it's starred before list operations
    const repoNodeId = await withErrorHandling(
      async () => {
        logger.log("[stars] bg | getRepoNodeId...");
        const id = await getRepoNodeId(owner, repo, token);
        logger.log("[stars] bg | starRepository...");
        await starRepository(id, token);
        return id;
      },
      tabId,
      owner,
      repo,
      "star operation",
      "[stars] bg",
    );
    if (repoNodeId === null) return;

    // AI categorize
    logger.log(
      "[stars] bg | AI categorize | provider:",
      settings.activeProvider,
      "| model:",
      settings.providers[settings.activeProvider]?.model,
    );
    const result = await categorizeAndAssign(
      tabId,
      owner,
      repo,
      token,
      settings,
      client,
      repoNodeId,
      metadata,
      lists,
    );
    if (result) {
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
    }
  } catch (err) {
    logger.error("Extension error:", err);
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

    const settings = await storage.getSettings();
    const token = settings.githubToken;

    if (!token) {
      await sendStatus(
        tabId,
        owner,
        repo,
        "error",
        undefined,
        "GitHub token is required",
      );
      return;
    }

    await sendStatus(tabId, owner, repo, "categorizing");

    const client = createProviderClient(
      settings.activeProvider,
      settings.providers[settings.activeProvider],
    );
    if (!client) {
      await sendStatus(
        tabId,
        owner,
        repo,
        "error",
        undefined,
        "No AI provider configured",
      );
      return;
    }

    // Remove repo from current lists (pass empty listIds to clear all lists)
    const removeOk = await withErrorHandling(
      async () => {
        logger.log("[regenerate] bg | removing from list:", record.listName);
        await updateUserListsForItem(record.nodeId, [], token);
        return true;
      },
      tabId,
      owner,
      repo,
      "remove from list",
      "[regenerate] bg",
    );
    if (removeOk === null) return;

    // Get viewer lists (to re-match)
    const lists = await withErrorHandling(
      () => getViewerLists(token),
      tabId,
      owner,
      repo,
      "getViewerLists",
      "[regenerate] bg",
    );
    if (lists === null) return;

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
      token,
      settings,
      client,
      record.nodeId,
      metadata,
      lists,
      allRejected,
    );
    if (result) {
      await storage.saveRepo({
        ...record,
        listId: result.listId,
        listName: result.listName,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    logger.error("[regenerate] Error:", err);
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

let batchAbortController: AbortController | null = null;

async function handleStartBatch(): Promise<
  { alreadyRunning: true } | { error: string } | null
> {
  const current = await browser.storage.session
    .get("batchStatus")
    .then((r) => r.batchStatus as BatchStatus | undefined);
  if (current?.state === "running") {
    return { alreadyRunning: true };
  }

  const settings = await storage.getSettings();
  const token = settings.githubToken;

  if (!token) {
    return {
      error: "GitHub token is required. Add it in the extension popup.",
    };
  }

  const client = createProviderClient(
    settings.activeProvider,
    settings.providers[settings.activeProvider],
  );
  if (!client) {
    return { error: "No AI provider configured. Open the extension popup." };
  }

  batchAbortController = new AbortController();
  const signal = batchAbortController.signal;

  const runningStatus: BatchStatus = {
    state: "running",
    current: 0,
    currentRepo: "",
  };
  await updateBatchStatus(runningStatus);

  try {
    const result = await batchCategorize({
      token,
      client,
      settings: {
        listPrivacy: settings.listPrivacy,
        enableEmojis: settings.enableEmojis,
        enableCategoryPrefix: settings.enableCategoryPrefix,
        autoFormat: settings.autoFormat,
      },
      signal,
      onProgress: async (current, repoName, message) => {
        const status: BatchStatus = {
          state: "running",
          current,
          currentRepo: repoName,
          message,
        };
        await updateBatchStatus(status);
      },
    });

    const terminalStatus: BatchStatus = result.cancelled
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
        };

    await updateBatchStatus(terminalStatus);
  } catch (err) {
    const errorStatus: BatchStatus = {
      state: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
    await updateBatchStatus(errorStatus);
    logger.error("[batch] bg | batchCategorize failed:", err);
  } finally {
    batchAbortController = null;
  }

  return null;
}

async function handleCancelBatch(): Promise<
  { success: true } | { notRunning: true }
> {
  if (!batchAbortController) {
    return { notRunning: true };
  }

  batchAbortController.abort();
  return { success: true };
}

async function updateBatchStatus(status: BatchStatus): Promise<void> {
  await browser.storage.session.set({ batchStatus: status });
  try {
    await browser.runtime.sendMessage({
      type: "batchProgress",
      payload: status,
    } as BatchProgressMessage);
  } catch {
    // Popup may not be open
  }
}

let syncAbortController: AbortController | null = null;

async function handleSyncRepos(): Promise<
  { alreadyRunning: true } | { error: string } | null
> {
  const current = await browser.storage.session
    .get("syncStatus")
    .then((r) => r.syncStatus as SyncStatus | undefined);
  if (current?.state === "running") {
    return { alreadyRunning: true };
  }

  const settings = await storage.getSettings();
  const token = settings.githubToken;

  if (!token) {
    return {
      error: "GitHub token is required. Add it in the extension popup.",
    };
  }

  syncAbortController = new AbortController();
  const signal = syncAbortController.signal;

  await updateSyncStatus({ state: "running", synced: 0 });

  let synced = 0;
  try {
    await updateSyncStatus({
      state: "running",
      synced: 0,
      message: "Fetching repo lists...",
    });
    const listMap = await getRepoListMap(token, signal);

    for await (const repo of streamAllStarredRepos(token, signal)) {
      if (signal.aborted) break;

      const membership = listMap.get(repo.nodeId);
      const now = new Date().toISOString();
      await storage.saveRepo({
        owner: repo.owner,
        repo: repo.repo,
        fullName: repo.nameWithOwner,
        nodeId: repo.nodeId,
        description: repo.description,
        language: repo.language,
        topics: repo.topics,
        listId: membership?.listId,
        listName: membership?.listName,
        starredAt: now,
        updatedAt: now,
      });

      synced++;
      await updateSyncStatus({
        state: "running",
        synced,
        message: `Syncing ${repo.nameWithOwner}...`,
      });
    }

    const terminalStatus: SyncStatus = signal.aborted
      ? {
          state: "cancelled",
          synced,
          completedAt: new Date().toISOString(),
        }
      : {
          state: "done",
          synced,
          completedAt: new Date().toISOString(),
        };

    await updateSyncStatus(terminalStatus);
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === "AbortError")) {
      const cancelledStatus: SyncStatus = {
        state: "cancelled",
        synced,
        completedAt: new Date().toISOString(),
      };
      await updateSyncStatus(cancelledStatus);
    } else {
      const errorStatus: SyncStatus = {
        state: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      };
      await updateSyncStatus(errorStatus);
      logger.error("[sync] bg | syncRepos failed:", err);
    }
  } finally {
    syncAbortController = null;
  }

  return null;
}

async function handleCancelSync(): Promise<
  { success: true } | { notRunning: true }
> {
  if (!syncAbortController) {
    return { notRunning: true };
  }

  syncAbortController.abort();
  return { success: true };
}

async function updateSyncStatus(status: SyncStatus): Promise<void> {
  await browser.storage.session.set({ syncStatus: status });
  try {
    await browser.runtime.sendMessage({
      type: "syncProgress",
      payload: status,
    } as SyncProgressMessage);
  } catch {
    // Popup may not be open
  }
}
