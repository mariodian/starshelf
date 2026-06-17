import { storage } from "@/shared/storage";
import type { ExtensionSettings } from "@/shared/storage";
import { createProviderClient } from "@/shared/providers/factory";
import { h } from "./shared";

let settings: ExtensionSettings;
const DIRTY_MASK = "\u2022".repeat(12);
let isRendering = false;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let root: HTMLElement | null = null;

export function renderSettingsTab(): HTMLElement {
  root = h("div", { id: "settingsTab" });
  root.innerHTML = `
    <section>
      <h2>GitHub Token</h2>
      <p>
        Create a
        <a href="https://github.com/settings/tokens/new" target="_blank"
          >classic personal access token</a
        >
        with the <code>user</code>, <code>public_repo</code> and
        <code>gist</code> scope.
      </p>
      <div class="field">
        <input
          type="password"
          id="githubToken"
          placeholder="ghp_..."
          autocomplete="off"
        />
        <button id="deleteGithubToken" class="danger">Delete</button>
      </div>
      <p class="hint">
        Only classic tokens work. Fine-grained PATs lack the required
        star-list API access.
      </p>
    </section>

    <section>
      <h2>AI Provider</h2>
      <div class="field">
        <select id="aiProvider">
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="opencode">OpenCode</option>
        </select>
      </div>
    </section>

    <section id="providerSettings">
      <h2>Provider Settings</h2>

      <div class="field">
        <label for="apiKey">API Key</label>
        <input type="password" id="apiKey" autocomplete="off" />
        <button id="deleteApiKey" class="danger">Delete Key</button>
      </div>

      <div class="field" id="openCodeEndpointField" style="display: none">
        <label for="openCodeEndpoint">Endpoint</label>
        <select id="openCodeEndpoint">
          <option value="zen">Zen</option>
          <option value="zen-go">Go</option>
        </select>
      </div>

      <div class="field">
        <label for="modelSelect">Model</label>
        <select id="modelSelect"></select>
        <button id="fetchModels">Fetch</button>
      </div>
      <p class="hint">
        Using a cheaper model will reduce costs, but may result in less
        accurate suggestions.
      </p>
    </section>

    <section>
      <h2>List Privacy</h2>
      <div class="field">
        <label for="listPrivacy">New lists</label>
        <select id="listPrivacy">
          <option value="private">Private</option>
          <option value="public">Public</option>
        </select>
      </div>
      <p class="hint">
        Private lists are only visible to you, while public lists can be seen
        by anyone. You can change the privacy of each list later on GitHub.
      </p>
    </section>

    <section>
      <h2>Formatting</h2>
      <div class="field">
        <input type="checkbox" id="autoFormat" />
        <label for="autoFormat">Auto-format</label>
      </div>
      <p class="hint">
        When enabled, Starshelf auto-detects and follows your existing naming
        conventions (emojis and category prefixes). Disable to force your
        preferred style regardless of past list names.
      </p>
      <div class="field separate">
        <input type="checkbox" id="enableEmojis" />
        <label for="enableEmojis">Enable emojis</label>
      </div>
      <div class="field">
        <input type="checkbox" id="enableCategoryPrefix" />
        <label for="enableCategoryPrefix">Enable category prefix</label>
      </div>
    </section>
  `;
  return root;
}

export async function initSettingsTab(): Promise<void> {
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

  el.deleteGithubToken.addEventListener("click", async () => {
    settings.githubToken = undefined;
    await storage.remove("githubToken");
    el.githubToken.value = "";
    flash("GitHub token deleted");
  });

  el.deleteApiKey.addEventListener("click", async () => {
    setProviderConfig(settings.activeProvider, { apiKey: undefined });
    await storage.set("providers", settings.providers);
    el.apiKey.value = "";
    flash("API key deleted");
  });

  el.aiProvider.addEventListener("change", () => {
    if (isRendering) return;
    settings.activeProvider = el.aiProvider
      .value as ExtensionSettings["activeProvider"];
    storage.set("activeProvider", settings.activeProvider);
    clearDebounce("apiKey");
    clearDebounce("endpoint");
    clearDebounce("model");
    el.modelSelect.innerHTML = "";
    render();
    flash("Provider saved");
  });

  el.openCodeEndpoint.addEventListener("change", () => {
    if (isRendering) return;
    settings.providers.opencode = {
      ...settings.providers.opencode,
      endpoint: el.openCodeEndpoint.value as "zen" | "zen-go",
    };
    storage.set("providers", settings.providers);
    if (settings.providerModels) {
      delete settings.providerModels.opencode;
      storage.set("providerModels", settings.providerModels);
    }
    el.modelSelect.innerHTML = "";
    flash("Endpoint saved");
  });

  el.modelSelect.addEventListener("change", () => {
    if (isRendering) return;
    setProviderConfig(settings.activeProvider, {
      model: el.modelSelect.value || undefined,
    });
    storage.set("providers", settings.providers);
    flash("Model saved");
  });

  el.listPrivacy.addEventListener("change", () => {
    if (isRendering) return;
    settings.listPrivacy = el.listPrivacy.value as "public" | "private";
    storage.set("listPrivacy", settings.listPrivacy);
    flash("Privacy saved");
  });

  el.enableEmojis.addEventListener("change", () => {
    if (isRendering) return;
    settings.enableEmojis = el.enableEmojis.checked;
    storage.set("enableEmojis", settings.enableEmojis);
    flash("Emoji setting saved");
  });

  el.enableCategoryPrefix.addEventListener("change", () => {
    if (isRendering) return;
    settings.enableCategoryPrefix = el.enableCategoryPrefix.checked;
    storage.set("enableCategoryPrefix", settings.enableCategoryPrefix);
    flash("Category prefix setting saved");
  });

  el.autoFormat.addEventListener("change", () => {
    if (isRendering) return;
    settings.autoFormat = el.autoFormat.checked;
    storage.set("autoFormat", settings.autoFormat);
    el.enableEmojis.disabled = settings.autoFormat;
    el.enableCategoryPrefix.disabled = settings.autoFormat;
    flash("Auto-format setting saved");
  });

  el.githubToken.addEventListener("blur", () => {
    if (isRendering) return;
    clearDebounce("githubToken");
    saveGithubToken();
  });

  el.githubToken.addEventListener("input", () => {
    if (isRendering) return;
    debounce("githubToken", () => saveGithubToken());
  });

  el.apiKey.addEventListener("blur", () => {
    if (isRendering) return;
    clearDebounce("apiKey");
    saveApiKey();
  });

  el.apiKey.addEventListener("input", () => {
    if (isRendering) return;
    debounce("apiKey", () => saveApiKey());
  });

  el.fetchModels.addEventListener("click", async () => {
    const p = settings.activeProvider;
    const c = settings.providers[p];
    if (!c.apiKey) {
      flash("Enter an API key first", true);
      return;
    }

    el.fetchModels.disabled = true;
    el.fetchModels.textContent = "Fetching...";

    try {
      const client = createProviderClient(p, settings.providers[p]);
      if (!client?.listModels) throw new Error("Unknown provider");
      const models = await client.listModels();
      const saved = c.model;
      el.modelSelect.innerHTML = "";
      for (const id of models) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id;
        el.modelSelect.appendChild(opt);
      }
      if (saved && models.includes(saved)) {
        el.modelSelect.value = saved;
      }
      settings.providerModels = { ...settings.providerModels, [p]: models };
      await storage.set("providerModels", settings.providerModels);
    } catch (err) {
      flash(
        `Failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        true,
      );
    } finally {
      el.fetchModels.disabled = false;
      el.fetchModels.textContent = "Fetch";
    }
  });
}

function saveGithubToken() {
  const el = getElements();
  const val = el.githubToken.value;
  if (val && val !== DIRTY_MASK) {
    settings.githubToken = val;
    storage.set("githubToken", val).then(() => flash("GitHub token saved"));
  } else if (val === "" && settings.githubToken) {
    settings.githubToken = undefined;
    storage.remove("githubToken").then(() => flash("GitHub token removed"));
  }
}

function saveApiKey() {
  const el = getElements();
  const val = el.apiKey.value;
  if (val && val !== DIRTY_MASK) {
    setProviderConfig(settings.activeProvider, { apiKey: val });
    storage
      .set("providers", settings.providers)
      .then(() => flash("API key saved"));
  } else if (val === "" && settings.providers[settings.activeProvider].apiKey) {
    setProviderConfig(settings.activeProvider, { apiKey: undefined });
    storage
      .set("providers", settings.providers)
      .then(() => flash("API key removed"));
  }
}

function render() {
  const el = getElements();
  isRendering = true;

  el.githubToken.value = settings.githubToken ? DIRTY_MASK : "";
  el.aiProvider.value = settings.activeProvider;

  const p = settings.activeProvider;
  const c = settings.providers[p];

  el.apiKey.value = c.apiKey ? DIRTY_MASK : "";

  const cached = settings.providerModels?.[p];
  if (cached && cached.length > 0) {
    el.modelSelect.innerHTML = "";
    for (const id of cached) {
      const opt = document.createElement("option");
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
      const opt = document.createElement("option");
      opt.value = c.model;
      opt.textContent = c.model;
      el.modelSelect.appendChild(opt);
    }
    el.modelSelect.value = c.model;
  }

  el.openCodeEndpointField.style.display = p === "opencode" ? "flex" : "none";
  if (p === "opencode") {
    el.openCodeEndpoint.value = settings.providers.opencode.endpoint;
  }
  el.autoFormat.checked = settings.autoFormat;

  el.fetchModels.style.display = "inline-block";

  el.listPrivacy.value = settings.listPrivacy;

  el.enableEmojis.checked = settings.enableEmojis;
  el.enableCategoryPrefix.checked = settings.enableCategoryPrefix;
  el.enableEmojis.disabled = settings.autoFormat;
  el.enableCategoryPrefix.disabled = settings.autoFormat;

  isRendering = false;
}

function setProviderConfig(
  provider: ExtensionSettings["activeProvider"],
  update: Record<string, string | undefined>,
) {
  switch (provider) {
    case "anthropic":
      settings.providers.anthropic = {
        ...settings.providers.anthropic,
        ...update,
      };
      break;
    case "openai":
      settings.providers.openai = { ...settings.providers.openai, ...update };
      break;
    case "opencode":
      settings.providers.opencode = {
        ...settings.providers.opencode,
        ...update,
      };
      break;
  }
}

function flash(msg: string, isError = false) {
  const existing = document.getElementById("flash");
  if (existing) {
    existing.textContent = msg;
    existing.className = isError ? "flash flash-error" : "flash";
    existing.style.opacity = "1";
    setTimeout(() => {
      existing.style.opacity = "0";
    }, 2500);
    return;
  }

  const div = document.createElement("div");
  div.id = "flash";
  div.textContent = msg;
  div.className = isError ? "flash flash-error" : "flash";
  document.body.appendChild(div);
  requestAnimationFrame(() => {
    div.style.opacity = "1";
  });
  setTimeout(() => {
    div.style.opacity = "0";
  }, 2500);
}

function getElements() {
  const container = root ?? document;
  return {
    githubToken: container.querySelector("#githubToken") as HTMLInputElement,
    deleteGithubToken: container.querySelector(
      "#deleteGithubToken",
    ) as HTMLButtonElement,
    aiProvider: container.querySelector("#aiProvider") as HTMLSelectElement,
    apiKey: container.querySelector("#apiKey") as HTMLInputElement,
    deleteApiKey: container.querySelector("#deleteApiKey") as HTMLButtonElement,
    openCodeEndpointField: container.querySelector(
      "#openCodeEndpointField",
    ) as HTMLElement,
    openCodeEndpoint: container.querySelector(
      "#openCodeEndpoint",
    ) as HTMLSelectElement,
    fetchModels: container.querySelector("#fetchModels") as HTMLButtonElement,
    modelSelect: container.querySelector("#modelSelect") as HTMLSelectElement,
    listPrivacy: container.querySelector("#listPrivacy") as HTMLSelectElement,
    enableEmojis: container.querySelector("#enableEmojis") as HTMLInputElement,
    enableCategoryPrefix: container.querySelector(
      "#enableCategoryPrefix",
    ) as HTMLInputElement,
    autoFormat: container.querySelector("#autoFormat") as HTMLInputElement,
  };
}
