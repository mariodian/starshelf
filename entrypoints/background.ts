import type { ContentMessage, UpdateStarStatusMessage } from '@/shared/types/messages';
import { storage, type ExtensionSettings } from '@/shared/storage';
import {
  fetchRepoMetadata,
  isRepoPage,
} from '@/shared/github';
import {
  validateToken,
  getViewerLists,
  createUserList,
  getRepoNodeId,
  updateUserListsForItem,
  fuzzyMatchListName,
  type GitHubList,
} from '@/shared/github-lists';
import { AnthropicClient } from '@/shared/providers/anthropic';
import { OpenAIClient } from '@/shared/providers/openai';
import { OpenCodeClient } from '@/shared/providers/opencode';
import type { AiProviderClient } from '@/shared/providers/base';
import { categorizeRepository } from '@/shared/categorizer';

export default defineBackground(() => {
  if (import.meta.env.DEV) {
    import('@/shared/dev-bootstrap').then((m) => m.seedFromEnvIfMissing());
  }

  browser.runtime.onMessage.addListener(
    (message: ContentMessage, sender) => {
      if (message.type === 'repoStarClicked') {
        console.log('[stars] bg received | action:', message.payload.action, '| repo:', message.payload.owner + '/' + message.payload.repo);
        handleStarClick(message.payload, sender.tab?.id, sender.tab?.url);
      }
    },
  );
});

const inFlight = new Set<string>();

async function handleStarClick(
  payload: { owner: string; repo: string; action: 'star' | 'unstar' },
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
      await sendStatus(tabId, owner, repo, 'error', undefined,
        'GitHub token is required. Add it in the extension popup.',
      );
      return;
    }

    // Unstar — just clear local cache, no API calls needed.
    // GitHub handles removing the repo from any lists on unstar.
    if (action === 'unstar') {
      console.log('[stars] bg unstar branch | fullName:', fullName);
      if (settings.categorizedRepos[fullName]) {
        const categorizedRepos = { ...settings.categorizedRepos };
        delete categorizedRepos[fullName];
        await storage.setSettings({ ...settings, categorizedRepos });
      }
      await sendStatus(tabId, owner, repo, 'removed');
      return;
    }

    // Star
    await sendStatus(tabId, owner, repo, 'categorizing');

    // Validate token scope
    try {
      await validateToken(token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Token validation failed';
      await sendStatus(tabId, owner, repo, 'error', undefined, msg);
      return;
    }

    const cached = settings.categorizedRepos[fullName];
    if (cached) {
      await sendStatus(tabId, owner, repo, 'saved', cached.category);
      return;
    }

    // Fetch repo metadata and existing lists in parallel
    const [metadata, lists] = await Promise.all([
      fetchRepoMetadata(owner, repo, token),
      getViewerLists(token),
    ]);

    const client = buildClient(settings);
    if (!client) {
      await sendStatus(tabId, owner, repo, 'error', undefined,
        'No AI provider configured. Open the extension popup.',
      );
      return;
    }

    // AI gets existing list names so it can choose one
    const existingNames = lists.map((l) => l.name);
    const category = await categorizeRepository(client, metadata, owner, repo, existingNames);

    // Fuzzy-match category against existing lists
    const matchedList = fuzzyMatchListName(category, lists);

    if (matchedList) {
      const repoNodeId = await getRepoNodeId(owner, repo, token);
      await updateUserListsForItem(repoNodeId, [matchedList.id], token);

      const categorizedRepos = { ...settings.categorizedRepos };
      categorizedRepos[fullName] = { category: matchedList.name, starredAt: Date.now() };
      await storage.setSettings({ ...settings, categorizedRepos });

      await sendStatus(tabId, owner, repo, 'saved', matchedList.name);
    } else {
      const isPrivate = settings.listPrivacy === 'private';
      const newList = await createUserList(category, isPrivate, token);

      const repoNodeId = await getRepoNodeId(owner, repo, token);
      await updateUserListsForItem(repoNodeId, [newList.id], token);

      const categorizedRepos = { ...settings.categorizedRepos };
      categorizedRepos[fullName] = { category, starredAt: Date.now() };
      await storage.setSettings({ ...settings, categorizedRepos });

      await sendStatus(tabId, owner, repo, 'saved', category);
    }
  } catch (err) {
    console.error('Star categorizer error:', err);
    const msg = err instanceof Error ? err.message : 'Unexpected error';
    await sendStatus(tabId, owner, repo, 'error', undefined, msg);
  } finally {
    inFlight.delete(fullName);
  }
}

async function sendStatus(
  tabId: number,
  owner: string,
  repo: string,
  status: UpdateStarStatusMessage['payload']['status'],
  category?: string,
  error?: string,
) {
  const message: UpdateStarStatusMessage = {
    type: 'updateStarStatus',
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
    case 'anthropic':
      if (!c.apiKey || !c.model) return null;
      return new AnthropicClient(c.apiKey, c.model);
    case 'openai':
      if (!c.apiKey || !c.model) return null;
      return new OpenAIClient(c.apiKey, c.model);
    case 'opencode':
      if (!c.apiKey || !c.model) return null;
      return new OpenCodeClient(c.apiKey, c.model, settings.providers.opencode.endpoint);
    default:
      return null;
  }
}
