import Fuse from "fuse.js";
import type { SyncStatus, BackgroundMessage } from "@/shared/types/messages";
import { storage, type RepoRecord } from "@/shared/storage";

export function initSearchUI() {
  const disabledState = document.getElementById("searchDisabledState")!;
  const enabledState = document.getElementById("searchEnabledState")!;
  const searchInput = document.getElementById(
    "searchInput",
  ) as HTMLInputElement;
  const searchResults = document.getElementById("searchResults")!;
  const fullSyncBtn = document.getElementById(
    "fullSyncBtn",
  ) as HTMLButtonElement;
  const cancelSyncBtn = document.getElementById(
    "cancelSync",
  ) as HTMLButtonElement;
  const syncStatusEl = document.getElementById("syncStatus")!;

  let fuse: Fuse<RepoRecord> | null = null;
  let allRepos: RepoRecord[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  loadState();

  async function loadState() {
    const repos = await storage.getRepos();
    allRepos = Object.values(repos);

    if (allRepos.length === 0) {
      disabledState.style.display = "";
      enabledState.style.display = "none";
    } else {
      disabledState.style.display = "none";
      enabledState.style.display = "";
      fuse = new Fuse(allRepos, {
        keys: [
          { name: "fullName", weight: 0.4 },
          { name: "description", weight: 0.25 },
          { name: "topics", weight: 0.15 },
          { name: "language", weight: 0.1 },
          { name: "listName", weight: 0.1 },
        ],
        threshold: 0.3,
        includeScore: true,
      });
    }

    loadSyncStatus();
  }

  async function loadSyncStatus() {
    const status = await browser.storage.session
      .get("syncStatus")
      .then((r) => r.syncStatus as SyncStatus | undefined);
    renderSyncStatus(status ?? { state: "idle" });
  }

  function renderSyncStatus(status: SyncStatus) {
    switch (status.state) {
      case "idle":
        fullSyncBtn.style.display = "";
        cancelSyncBtn.style.display = "none";
        syncStatusEl.textContent = "Ready";
        break;

      case "running":
        fullSyncBtn.style.display = "none";
        cancelSyncBtn.style.display = "";
        syncStatusEl.textContent =
          status.message ?? `Syncing... (${status.synced} repos)`;
        break;

      case "done":
        fullSyncBtn.style.display = "";
        cancelSyncBtn.style.display = "none";
        syncStatusEl.textContent = `Synced ${status.synced} repos`;
        loadState();
        break;

      case "error":
        fullSyncBtn.style.display = "";
        cancelSyncBtn.style.display = "none";
        syncStatusEl.textContent = `Error: ${status.message}`;
        break;

      case "cancelled":
        fullSyncBtn.style.display = "";
        cancelSyncBtn.style.display = "none";
        syncStatusEl.textContent = `Cancelled. ${status.synced} repos synced.`;
        loadState();
        break;
    }
  }

  fullSyncBtn.addEventListener("click", async () => {
    const reply = await browser.runtime.sendMessage({ type: "syncRepos" });
    if (reply?.alreadyRunning) {
      syncStatusEl.textContent = "Sync already running";
    } else if (reply?.error) {
      syncStatusEl.textContent = `Error: ${reply.error}`;
    }
  });

  cancelSyncBtn.addEventListener("click", () => {
    browser.runtime.sendMessage({ type: "cancelSync" });
    syncStatusEl.textContent = "Cancelling...";
  });

  searchInput.addEventListener("input", () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      performSearch(searchInput.value.trim());
    }, 150);
  });

  function performSearch(query: string) {
    if (!query) {
      searchResults.innerHTML = "";
      return;
    }

    if (!fuse) return;

    const results = fuse.search(query, { limit: 20 });
    searchResults.innerHTML = results
      .map(({ item }) => {
        const lang = item.language
          ? `<span class="result-lang">${escapeHtml(item.language)}</span>`
          : "";
        const list = item.listName
          ? `<span class="result-list">${escapeHtml(item.listName)}</span>`
          : "";
        const desc = item.description
          ? `<span class="result-desc">${escapeHtml(item.description)}</span>`
          : "";
        const topics =
          item.topics.length > 0
            ? `<span class="result-topics">${item.topics.map(escapeHtml).join(", ")}</span>`
            : "";

        return `<div class="search-result">
          <div class="result-header">
            <a href="https://github.com/${escapeHtml(item.fullName)}" target="_blank" class="result-name">${escapeHtml(item.fullName)}</a>
            ${list}${lang}
          </div>
          ${desc}${topics}
        </div>`;
      })
      .join("");
  }

  browser.runtime.onMessage.addListener((msg: BackgroundMessage) => {
    if (msg.type === "syncProgress") {
      renderSyncStatus(msg.payload);
    }
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
