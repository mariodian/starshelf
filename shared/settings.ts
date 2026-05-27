import { storage } from '@/shared/storage';
import type { ExtensionSettings } from '@/shared/storage';
import { OpenAIClient } from '@/shared/providers/openai';

let settings: ExtensionSettings;

export async function initSettingsPage() {
  settings = await storage.getSettings();
  render();
  wire();
}

function wire() {
  const el = getElements();

  el.saveGithubToken.addEventListener('click', async () => {
    const val = el.githubToken.value;
    if (!val || val === '\u2022'.repeat(12)) return;
    settings.githubToken = val;
    await storage.set('githubToken', val);
    el.githubToken.value = '\u2022'.repeat(12);
    flash('GitHub token saved');
  });

  el.deleteGithubToken.addEventListener('click', async () => {
    settings.githubToken = undefined;
    await storage.remove('githubToken');
    el.githubToken.value = '';
    flash('GitHub token deleted');
  });

  el.aiProvider.addEventListener('change', async () => {
    settings.activeProvider = el.aiProvider.value as ExtensionSettings['activeProvider'];
    await storage.set('activeProvider', settings.activeProvider);
    render();
  });

  el.saveApiKey.addEventListener('click', async () => {
    const val = el.apiKey.value;
    if (!val || val === '\u2022'.repeat(12)) return;
    setProviderConfig(settings.activeProvider, { apiKey: val });
    await storage.set('providers', settings.providers);
    el.apiKey.value = '\u2022'.repeat(12);
    flash('API key saved');
  });

  el.deleteApiKey.addEventListener('click', async () => {
    setProviderConfig(settings.activeProvider, { apiKey: undefined });
    await storage.set('providers', settings.providers);
    el.apiKey.value = '';
    flash('API key deleted');
  });

  el.openCodeEndpoint.addEventListener('change', async () => {
    if (settings.activeProvider === 'opencode') {
      settings.providers.opencode = {
        ...settings.providers.opencode,
        endpoint: el.openCodeEndpoint.value as 'zen' | 'zen-go',
      };
      await storage.set('providers', settings.providers);
    }
  });

  el.model.addEventListener('change', async () => {
    setProviderConfig(settings.activeProvider, { model: el.model.value || undefined });
    await storage.set('providers', settings.providers);
  });

  el.listPrivacy.addEventListener('change', async () => {
    settings.listPrivacy = el.listPrivacy.value as 'public' | 'private';
    await storage.set('listPrivacy', settings.listPrivacy);
  });

  el.fetchModels.addEventListener('click', async () => {
    const c = settings.providers.openai;
    if (!c.apiKey) {
      flash('Enter an OpenAI API key first', true);
      return;
    }

    el.fetchModels.disabled = true;
    el.fetchModels.textContent = 'Fetching...';

    try {
      const client = new OpenAIClient(c.apiKey, c.model ?? 'gpt-4o');
      const models = await client.listModels();
      el.modelSelect.innerHTML = '';
      for (const id of models) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        el.modelSelect.appendChild(opt);
      }
      el.modelSelect.style.display = 'block';

      el.modelSelect.addEventListener('change', () => {
        settings.providers.openai = {
          ...settings.providers.openai,
          model: el.modelSelect.value,
        };
        el.model.value = el.modelSelect.value;
        storage.set('providers', settings.providers);
      });
    } catch (err) {
      flash(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, true);
    } finally {
      el.fetchModels.disabled = false;
      el.fetchModels.textContent = 'Fetch Models';
    }
  });
}

function render() {
  const el = getElements();

  el.githubToken.value = settings.githubToken ? '\u2022'.repeat(12) : '';
  el.aiProvider.value = settings.activeProvider;

  const p = settings.activeProvider;
  const c = settings.providers[p];

  el.apiKey.value = c.apiKey ? '\u2022'.repeat(12) : '';
  el.model.value = c.model ?? '';

  el.openCodeEndpointField.style.display = p === 'opencode' ? 'flex' : 'none';
  if (p === 'opencode') {
    el.openCodeEndpoint.value = settings.providers.opencode.endpoint;
  }

  el.fetchModels.style.display = p === 'openai' ? 'inline-block' : 'none';
  el.modelSelect.style.display = 'none';

  el.listPrivacy.value = settings.listPrivacy;

  renderRepoList(el);
}

function setProviderConfig(
  provider: ExtensionSettings['activeProvider'],
  update: Record<string, string | undefined>,
) {
  switch (provider) {
    case 'anthropic':
      settings.providers.anthropic = { ...settings.providers.anthropic, ...update };
      break;
    case 'openai':
      settings.providers.openai = { ...settings.providers.openai, ...update };
      break;
    case 'opencode':
      settings.providers.opencode = { ...settings.providers.opencode, ...update };
      break;
  }
}

function renderRepoList(el: ReturnType<typeof getElements>) {
  const entries = Object.entries(settings.categorizedRepos);
  if (entries.length === 0) {
    el.repoList.innerHTML = '<p class="muted">No repositories categorized yet. Star a repo on GitHub to begin.</p>';
    return;
  }

  el.repoList.innerHTML = entries
    .map(
      ([fullName, data]) => `
      <div class="repo-row">
        <span class="repo-name">${escapeHtml(fullName)}</span>
        <span class="repo-tag">${escapeHtml(data.category)}</span>
        <button class="danger small" data-repo="${escapeAttr(fullName)}">Remove</button>
      </div>`,
    )
    .join('');

  el.repoList.querySelectorAll<HTMLButtonElement>('.danger.small').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const repo = btn.dataset.repo!;
      const updated = { ...settings.categorizedRepos };
      delete updated[repo];
      settings.categorizedRepos = updated;
      await storage.set('categorizedRepos', updated);
      renderRepoList(el);
    });
  });
}

function flash(msg: string, isError = false) {
  const existing = document.getElementById('flash');
  if (existing) {
    existing.textContent = msg;
    existing.className = isError ? 'flash flash-error' : 'flash';
    existing.style.opacity = '1';
    setTimeout(() => { existing.style.opacity = '0'; }, 2500);
    return;
  }

  const div = document.createElement('div');
  div.id = 'flash';
  div.textContent = msg;
  div.className = isError ? 'flash flash-error' : 'flash';
  document.body.appendChild(div);
  requestAnimationFrame(() => { div.style.opacity = '1'; });
  setTimeout(() => { div.style.opacity = '0'; }, 2500);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string) {
  return s.replace(/"/g, '&quot;');
}

let _elCache: ReturnType<typeof queryElements> | null = null;

function getElements() {
  if (!_elCache) _elCache = queryElements();
  return _elCache;
}

function queryElements() {
  return {
    githubToken: document.getElementById('githubToken') as HTMLInputElement,
    saveGithubToken: document.getElementById('saveGithubToken') as HTMLButtonElement,
    deleteGithubToken: document.getElementById('deleteGithubToken') as HTMLButtonElement,
    aiProvider: document.getElementById('aiProvider') as HTMLSelectElement,
    apiKey: document.getElementById('apiKey') as HTMLInputElement,
    saveApiKey: document.getElementById('saveApiKey') as HTMLButtonElement,
    deleteApiKey: document.getElementById('deleteApiKey') as HTMLButtonElement,
    openCodeEndpointField: document.getElementById('openCodeEndpointField') as HTMLElement,
    openCodeEndpoint: document.getElementById('openCodeEndpoint') as HTMLSelectElement,
    model: document.getElementById('model') as HTMLInputElement,
    fetchModels: document.getElementById('fetchModels') as HTMLButtonElement,
    modelSelect: document.getElementById('modelSelect') as HTMLSelectElement,
    listPrivacy: document.getElementById('listPrivacy') as HTMLSelectElement,
    repoList: document.getElementById('repoList') as HTMLElement,
  };
}
