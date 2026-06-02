import type {
  ContentMessage,
  UpdateStarStatusMessage,
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
  createUserList,
  getRepoNodeId,
  updateUserListsForItem,
  fuzzyMatchListName,
  starRepository,
  deleteUserList,
  type GitHubList,
} from "@/shared/github-lists";
import type { AiProviderClient } from "@/shared/providers/base";
import { createProviderClient } from "@/shared/providers/factory";
import { logger } from "@/shared/logger";

export default defineBackground(() => {
  if (import.meta.env.DEV) {
    import("@/shared/dev-bootstrap").then((m) => m.seedFromEnvIfMissing());
  }

  browser.runtime.onMessage.addListener((message: ContentMessage, sender) => {
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
    }
  });
});

const inFlight = new Set<string>();

interface StarcorderState {
  metadata: RepoMetadata;
  repoNodeId: string;
  listId: string;
  listName: string;
  isNewList: boolean;
}

const states = new Map<string, StarcorderState>();

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
  isNewList: boolean;
} | null> {
  const existingNames = lists.map((l) => l.name);

  const category = await withErrorHandling(
    async () => {
      const cat = await client.categorize(
        metadata,
        owner,
        repo,
        existingNames,
        settings.enableEmojis,
        settings.enableCategoryPrefix,
        settings.autoFormat,
        previousCategories ?? [],
      );
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

  const matchedList = fuzzyMatchListName(category, lists);
  logger.log(
    "[stars] bg | fuzzy match:",
    matchedList ? matchedList.name : "none",
  );

  if (matchedList) {
    const ok = await withErrorHandling(
      async () => {
        logger.log("[stars] bg | updateUserListsForItem...");
        await updateUserListsForItem(repoNodeId, [matchedList.id], token);
        logger.log("[stars] bg | added to list:", matchedList.name);
        return true;
      },
      tabId,
      owner,
      repo,
      "add to list",
      "[stars] bg",
    );
    if (ok === null) return null;

    await sendStatus(tabId, owner, repo, "saved", matchedList.name);
    return {
      category,
      listId: matchedList.id,
      listName: matchedList.name,
      isNewList: false,
    };
  }

  const newList = await withErrorHandling(
    async () => {
      const isPrivate = settings.listPrivacy === "private";
      logger.log("[stars] bg | createUserList:", category);
      const list = await createUserList(category, isPrivate, token);
      logger.log("[stars] bg | updateUserListsForItem...");
      await updateUserListsForItem(repoNodeId, [list.id], token);
      logger.log("[stars] bg | created+added to list:", list.name);
      return list;
    },
    tabId,
    owner,
    repo,
    "create list",
    "[stars] bg",
  );
  if (newList === null) return null;

  await sendStatus(tabId, owner, repo, "saved", category);
  return {
    category,
    listId: newList.id,
    listName: newList.name,
    isNewList: true,
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
      states.set(fullName, {
        metadata,
        repoNodeId,
        listId: result.listId,
        listName: result.listName,
        isNewList: result.isNewList,
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
    const prevState = states.get(fullName);
    if (!prevState) {
      await sendStatus(
        tabId,
        owner,
        repo,
        "error",
        undefined,
        "Cannot find saved state to regenerate",
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

    // Remove repo from current list (pass empty listIds to clear all lists)
    const removeOk = await withErrorHandling(
      async () => {
        logger.log("[regenerate] bg | removing from list:", prevState.listName);
        await updateUserListsForItem(prevState.repoNodeId, [], token);
        return true;
      },
      tabId,
      owner,
      repo,
      "remove from list",
      "[regenerate] bg",
    );
    if (removeOk === null) return;

    // Delete the list if it was created by this star action
    if (prevState.isNewList) {
      const deleteOk = await withErrorHandling(
        async () => {
          logger.log(
            "[regenerate] bg | deleting empty list:",
            prevState.listName,
          );
          await deleteUserList(prevState.listId, token);
          return true;
        },
        tabId,
        owner,
        repo,
        "delete list",
        "[regenerate] bg",
      );
      if (deleteOk === null) return;
    }

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

    const result = await categorizeAndAssign(
      tabId,
      owner,
      repo,
      token,
      settings,
      client,
      prevState.repoNodeId,
      prevState.metadata,
      lists,
      allRejected,
    );
    if (result) {
      states.set(fullName, {
        ...prevState,
        listId: result.listId,
        listName: result.listName,
        isNewList: result.isNewList,
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
