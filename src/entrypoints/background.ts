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
  type GitHubList,
} from "@/shared/github-lists";
import { AnthropicClient } from "@/shared/providers/anthropic";
import { OpenAIClient } from "@/shared/providers/openai";
import { OpenCodeClient } from "@/shared/providers/opencode";
import type { AiProviderClient } from "@/shared/providers/base";
import { categorizeRepository } from "@/shared/categorizer";
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
    }
  });
});

const inFlight = new Set<string>();

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
    try {
      logger.log("[stars] bg | validating token...");
      await validateToken(token);
      logger.log("[stars] bg | token valid");
    } catch (err) {
      logger.error("[stars] bg | token validation FAILED:", err);
      const msg =
        err instanceof Error ? err.message : "Token validation failed";
      await sendStatus(tabId, owner, repo, "error", undefined, msg);
      return;
    }

    // Fetch repo metadata
    let metadata: RepoMetadata;
    try {
      logger.log("[stars] bg | fetchRepoMetadata...");
      metadata = await fetchRepoMetadata(owner, repo, token);
      logger.log(
        "[stars] bg | metadata:",
        metadata.language,
        metadata.topics?.length,
        "topics",
      );
    } catch (err) {
      logger.error("[stars] bg | fetchRepoMetadata FAILED:", err);
      const msg =
        err instanceof Error ? err.message : "fetchRepoMetadata failed";
      await sendStatus(tabId, owner, repo, "error", undefined, msg);
      return;
    }

    // Get viewer lists
    let lists: GitHubList[];
    try {
      logger.log("[stars] bg | getViewerLists...");
      lists = await getViewerLists(token);
      logger.log("[stars] bg | lists:", lists.length);
    } catch (err) {
      logger.error("[stars] bg | getViewerLists FAILED:", err);
      const msg = err instanceof Error ? err.message : "getViewerLists failed";
      await sendStatus(tabId, owner, repo, "error", undefined, msg);
      return;
    }

    const client = buildClient(settings);
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
    let repoNodeId: string;
    try {
      logger.log("[stars] bg | getRepoNodeId...");
      repoNodeId = await getRepoNodeId(owner, repo, token);
      logger.log("[stars] bg | starRepository...");
      await starRepository(repoNodeId, token);
    } catch (err) {
      logger.error("[stars] bg | star operation FAILED:", err);
      const msg = err instanceof Error ? err.message : "Star operation failed";
      await sendStatus(tabId, owner, repo, "error", undefined, msg);
      return;
    }

    // AI categorize
    const existingNames = lists.map((l) => l.name);
    let category: string;
    try {
      logger.log(
        "[stars] bg | AI categorize | provider:",
        settings.activeProvider,
        "| model:",
        settings.providers[settings.activeProvider]?.model,
      );
      category = await categorizeRepository(
        client,
        metadata,
        owner,
        repo,
        existingNames,
      );
      logger.log("[stars] bg | AI result:", category);
    } catch (err) {
      logger.error("[stars] bg | AI categorize FAILED:", err);
      const msg =
        err instanceof Error ? err.message : "AI categorization failed";
      await sendStatus(tabId, owner, repo, "error", undefined, msg);
      return;
    }

    // Fuzzy-match category against existing lists
    const matchedList = fuzzyMatchListName(category, lists);
    logger.log(
      "[stars] bg | fuzzy match:",
      matchedList ? matchedList.name : "none",
    );

    if (matchedList) {
      try {
        logger.log("[stars] bg | updateUserListsForItem...");
        await updateUserListsForItem(repoNodeId, [matchedList.id], token);
        logger.log("[stars] bg | added to list:", matchedList.name);
      } catch (err) {
        logger.error("[stars] bg | add to list FAILED:", err);
        const msg =
          err instanceof Error ? err.message : "Adding to list failed";
        await sendStatus(tabId, owner, repo, "error", undefined, msg);
        return;
      }

      await sendStatus(tabId, owner, repo, "saved", matchedList.name);
    } else {
      try {
        const isPrivate = settings.listPrivacy === "private";
        logger.log("[stars] bg | createUserList:", category);
        const newList = await createUserList(category, isPrivate, token);
        logger.log("[stars] bg | updateUserListsForItem...");
        await updateUserListsForItem(repoNodeId, [newList.id], token);
        logger.log("[stars] bg | created+added to list:", newList.name);
      } catch (err) {
        logger.error("[stars] bg | create list FAILED:", err);
        const msg = err instanceof Error ? err.message : "Creating list failed";
        await sendStatus(tabId, owner, repo, "error", undefined, msg);
        return;
      }

      await sendStatus(tabId, owner, repo, "saved", category);
    }
  } catch (err) {
    logger.error("Extension error:", err);
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

function buildClient(settings: ExtensionSettings): AiProviderClient | null {
  const p = settings.activeProvider;
  const c = settings.providers[p];

  switch (p) {
    case "anthropic":
      if (!c.apiKey) return null;
      return new AnthropicClient(
        c.apiKey,
        c.model ?? "claude-haiku-4-5-20251001",
      );
    case "openai":
      if (!c.apiKey) return null;
      return new OpenAIClient(c.apiKey, c.model ?? "gpt-5-mini");
    case "opencode":
      if (!c.apiKey) return null;
      return new OpenCodeClient(
        c.apiKey,
        c.model ?? "deepseek-v4-flash",
        settings.providers.opencode.endpoint,
      );
    default:
      return null;
  }
}
