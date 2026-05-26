import type { ContentMessage, UpdateStarStatusMessage } from '@/shared/types/messages';
import { storage, type ExtensionSettings } from '@/shared/storage';
import {
  checkStarStatus,
  fetchRepoMetadata,
  isRepoPage,
} from '@/shared/github';
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
        handleStarClick(message.payload, sender.tab?.id, sender.tab?.url);
      }
    },
  );
});

async function handleStarClick(
  payload: { owner: string; repo: string; action: 'star' | 'unstar' },
  tabId?: number,
  tabUrl?: string,
) {
  if (!tabId) return;
  if (!tabUrl || !isRepoPage(tabUrl)) return;

  const { owner, repo, action } = payload;
  const fullName = `${owner}/${repo}`;

  try {
    if (action === 'unstar') {
      await removeCategorization(fullName);
      await sendStatus(tabId, owner, repo, 'removed');
      return;
    }

    await sendStatus(tabId, owner, repo, 'categorizing');

    const settings = await storage.getSettings();
    const token = settings.githubToken;

    if (token) {
      const isStarred = await checkStarStatus(owner, repo, token);
      if (!isStarred) {
        await sendStatus(tabId, owner, repo, 'removed');
        return;
      }
    }

    const metadata = await fetchRepoMetadata(owner, repo, token);
    const client = buildClient(settings);
    if (!client) {
      await sendStatus(
        tabId,
        owner,
        repo,
        'error',
        undefined,
        'No AI provider configured. Open extension options.',
      );
      return;
    }

    const category = await categorizeRepository(client, metadata, owner, repo);

    const categorizedRepos = { ...settings.categorizedRepos };
    categorizedRepos[fullName] = { category, starredAt: Date.now() };
    await storage.setSettings({ ...settings, categorizedRepos });

    await sendStatus(tabId, owner, repo, 'saved', category);
  } catch (err) {
    console.error('Star categorizer error:', err);
    const msg = err instanceof Error ? err.message : 'Unexpected error';
    await sendStatus(tabId, owner, repo, 'error', undefined, msg);
  }
}

async function removeCategorization(fullName: string) {
  const settings = await storage.getSettings();
  if (settings.categorizedRepos[fullName]) {
    const categorizedRepos = { ...settings.categorizedRepos };
    delete categorizedRepos[fullName];
    await storage.setSettings({ ...settings, categorizedRepos });
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
