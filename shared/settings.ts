import { storage } from '@/shared/storage';
import type { ExtensionSettings } from '@/shared/storage';
import { OpenAIClient } from '@/shared/providers/openai';
import { AnthropicClient } from '@/shared/providers/anthropic';
import { OpenCodeClient } from '@/shared/providers/opencode';

let settings: ExtensionSettings;
const DIRTY_MASK = '\u2022'.repeat(12);
let isRendering = false;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function initSettingsPage() {
  settings = await storage.getSettings();
  render();
  wire();
}

function debounce(key: string, fn: () => void, delay = 1500) {
  clearDebounce(key);
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      fn();
    }, delay),
  );
}

function clearDebounce(key: string) {
  const t = debounceTimers.get(key);
  if (t) {
    clearTimeout(t);
    debounceTimers.delete(key);
  }
}

function wire() {
  const el = getElements();

  el.deleteGithubToken.addEventListener('click', async () => {
    settings.githubToken = undefined;
    await storage.remove('githubToken');
    el.githubToken.value = '';
    flash('GitHub token deleted');
  });

  el.deleteApiKey.addEventListener('click', async () => {
    setProviderConfig(settings.activeProvider, { apiKey: undefined });
    await storage.set('providers', settings.providers);
    el.apiKey.value = '';
    flash('API key deleted');
  });

  el.aiProvider.addEventListener('change', () => {
    if (isRendering) return;
    settings.activeProvider = el.aiProvider.value as ExtensionSettings['activeProvider'];
    storage.set('activeProvider', settings.activeProvider);
    clearDebounce('apiKey');
    clearDebounce('endpoint');
    clearDebounce('model');
    el.modelSelect.innerHTML = '';
    render();
    flash('Provider saved');
  });

  el.openCodeEndpoint.addEventListener('change', () => {
    if (isRendering) return;
    settings.providers.opencode = {
      ...settings.providers.opencode,
      endpoint: el.openCodeEndpoint.value as 'zen' | 'zen-go',
    };
    storage.set('providers', settings.providers);
    if (settings.providerModels) {
      delete settings.providerModels.opencode;
      storage.set('providerModels', settings.providerModels);
    }
    el.modelSelect.innerHTML = '';
    flash('Endpoint saved');
  });

  el.modelSelect.addEventListener('change', () => {
    if (isRendering) return;
    setProviderConfig(settings.activeProvider, { model: el.modelSelect.value || undefined });
    storage.set('providers', settings.providers);
    flash('Model saved');
  });

  el.listPrivacy.addEventListener('change', () => {
    if (isRendering) return;
    settings.listPrivacy = el.listPrivacy.value as 'public' | 'private';
    storage.set('listPrivacy', settings.listPrivacy);
    flash('Privacy saved');
  });

  el.githubToken.addEventListener('blur', () => {
    if (isRendering) return;
    clearDebounce('githubToken');
    saveGithubToken();
  });

  el.githubToken.addEventListener('input', () => {
    if (isRendering) return;
    debounce('githubToken', () => saveGithubToken());
  });

  el.apiKey.addEventListener('blur', () => {
    if (isRendering) return;
    clearDebounce('apiKey');
    saveApiKey();
  });

  el.apiKey.addEventListener('input', () => {
    if (isRendering) return;
    debounce('apiKey', () => saveApiKey());
  });

  el.fetchModels.addEventListener('click', async () => {
    const p = settings.activeProvider;
    const c = settings.providers[p];
    if (!c.apiKey) {
      flash('Enter an API key first', true);
      return;
    }

    el.fetchModels.disabled = true;
    el.fetchModels.textContent = 'Fetching...';

    try {
      const client = buildFetchClient(p);
      if (!client) throw new Error('Unknown provider');
      const models = await client.listModels();
      const saved = c.model;
      el.modelSelect.innerHTML = '';
      for (const id of models) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        el.modelSelect.appendChild(opt);
      }
      if (saved && models.includes(saved)) {
        el.modelSelect.value = saved;
      }
      settings.providerModels = { ...settings.providerModels, [p]: models };
      await storage.set('providerModels', settings.providerModels);
    } catch (err) {
      flash(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, true);
    } finally {
      el.fetchModels.disabled = false;
      el.fetchModels.textContent = 'Fetch';
    }
  });
}

function saveGithubToken() {
  const el = getElements();
  const val = el.githubToken.value;
  if (val && val !== DIRTY_MASK) {
    settings.githubToken = val;
    storage.set('githubToken', val).then(() => flash('GitHub token saved'));
  } else if (val === '' && settings.githubToken) {
    settings.githubToken = undefined;
    storage.remove('githubToken').then(() => flash('GitHub token removed'));
  }
}

function saveApiKey() {
  const el = getElements();
  const val = el.apiKey.value;
  if (val && val !== DIRTY_MASK) {
    setProviderConfig(settings.activeProvider, { apiKey: val });
    storage.set('providers', settings.providers).then(() => flash('API key saved'));
  } else if (val === '' && settings.providers[settings.activeProvider].apiKey) {
    setProviderConfig(settings.activeProvider, { apiKey: undefined });
    storage.set('providers', settings.providers).then(() => flash('API key removed'));
  }
}

function render() {
  const el = getElements();
  isRendering = true;

  el.githubToken.value = settings.githubToken ? DIRTY_MASK : '';
  el.aiProvider.value = settings.activeProvider;

  const p = settings.activeProvider;
  const c = settings.providers[p];

  el.apiKey.value = c.apiKey ? DIRTY_MASK : '';

  const cached = settings.providerModels?.[p];
  if (cached && cached.length > 0) {
    el.modelSelect.innerHTML = '';
    for (const id of cached) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      el.modelSelect.appendChild(opt);
    }
    if (c.model && cached.includes(c.model)) {
      el.modelSelect.value = c.model;
    }
  } else if (c.model) {
    const existing = Array.from(el.modelSelect.options).map((o) => o.value);
    if (!existing.includes(c.model)) {
      const opt = document.createElement('option');
      opt.value = c.model;
      opt.textContent = c.model;
      el.modelSelect.appendChild(opt);
    }
    el.modelSelect.value = c.model;
  }

  el.openCodeEndpointField.style.display = p === 'opencode' ? 'flex' : 'none';
  if (p === 'opencode') {
    el.openCodeEndpoint.value = settings.providers.opencode.endpoint;
  }

  el.fetchModels.style.display = 'inline-block';

  el.listPrivacy.value = settings.listPrivacy;

  isRendering = false;
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

function buildFetchClient(provider: ExtensionSettings['activeProvider']) {
  switch (provider) {
    case 'openai':
      return new OpenAIClient(
        settings.providers.openai.apiKey!,
        settings.providers.openai.model ?? 'gpt-4o',
      );
    case 'anthropic':
      return new AnthropicClient(
        settings.providers.anthropic.apiKey!,
        settings.providers.anthropic.model ?? 'claude-sonnet-4-20250514',
      );
    case 'opencode':
      return new OpenCodeClient(
        settings.providers.opencode.apiKey!,
        settings.providers.opencode.model ?? 'gpt-4o',
        settings.providers.opencode.endpoint,
      );
  }
}

function flash(msg: string, isError = false) {
  const existing = document.getElementById('flash');
  if (existing) {
    existing.textContent = msg;
    existing.className = isError ? 'flash flash-error' : 'flash';
    existing.style.opacity = '1';
    setTimeout(() => {
      existing.style.opacity = '0';
    }, 2500);
    return;
  }

  const div = document.createElement('div');
  div.id = 'flash';
  div.textContent = msg;
  div.className = isError ? 'flash flash-error' : 'flash';
  document.body.appendChild(div);
  requestAnimationFrame(() => {
    div.style.opacity = '1';
  });
  setTimeout(() => {
    div.style.opacity = '0';
  }, 2500);
}

let _elCache: ReturnType<typeof queryElements> | null = null;

function getElements() {
  if (!_elCache) _elCache = queryElements();
  return _elCache;
}

function queryElements() {
  return {
    githubToken: document.getElementById('githubToken') as HTMLInputElement,
    deleteGithubToken: document.getElementById('deleteGithubToken') as HTMLButtonElement,
    aiProvider: document.getElementById('aiProvider') as HTMLSelectElement,
    apiKey: document.getElementById('apiKey') as HTMLInputElement,
    deleteApiKey: document.getElementById('deleteApiKey') as HTMLButtonElement,
    openCodeEndpointField: document.getElementById('openCodeEndpointField') as HTMLElement,
    openCodeEndpoint: document.getElementById('openCodeEndpoint') as HTMLSelectElement,
    fetchModels: document.getElementById('fetchModels') as HTMLButtonElement,
    modelSelect: document.getElementById('modelSelect') as HTMLSelectElement,
    listPrivacy: document.getElementById('listPrivacy') as HTMLSelectElement,
  };
}
