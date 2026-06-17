import Fuse from "fuse.js";
import type { SyncStatus } from "@/shared/types/messages";
import { storage, type RepoRecord } from "@/shared/storage";
import { h } from "./shared";

let root: HTMLElement | null = null;
let defaultEmpty: HTMLElement | null = null;
let readyEmpty: HTMLElement | null = null;
let searchEmpty: HTMLElement | null = null;
let syncControls: HTMLElement | null = null;
let searchInput: HTMLInputElement | null = null;
let searchResults: HTMLElement | null = null;
let fullSyncBtn: HTMLButtonElement | null = null;
let cancelSyncBtn: HTMLButtonElement | null = null;
let syncStatusEl: HTMLElement | null = null;

let fuse: Fuse<RepoRecord> | null = null;
let allRepos: RepoRecord[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function renderSearchTab(): HTMLElement {
  root = h("div", { id: "searchTab" });
  root.innerHTML = `
    <div class="search-bar">
      <input
        type="search"
        id="searchInput"
        placeholder="Search your starred repos"
        autocomplete="off"
      />
    </div>
    <div id="searchResults"></div>
    <div id="defaultEmpty" style="display: none">
      <p class="empty-title">No starred repos indexed yet</p>
      <p class="empty-hint">Star repos on GitHub or sync to get started.</p>
    </div>
    <div id="readyEmpty" style="display: none">
      <p class="empty-title">Ready to search</p>
      <p class="empty-hint">Start typing to find your starred repos.</p>
    </div>
    <div id="searchEmpty" style="display: none">
      <p class="empty-title">No results found</p>
      <p class="empty-hint">Try a different search term or sync for new repos.</p>
    </div>
    <div class="sync-controls" style="display: none">
      <button id="fullSyncBtn">Sync from GitHub</button>
      <button id="cancelSync" class="danger" style="display: none">
        Cancel
      </button>
      <span id="syncStatus" class="hint">Ready</span>
    </div>
  `;
  return root;
}

export async function initSearchTab(): Promise<void> {
  const container = root ?? document;
  defaultEmpty = container.querySelector("#defaultEmpty");
  readyEmpty = container.querySelector("#readyEmpty");
  searchEmpty = container.querySelector("#searchEmpty");
  syncControls = container.querySelector(".sync-controls");
  searchInput = container.querySelector(
    "#searchInput",
  ) as HTMLInputElement | null;
  searchResults = container.querySelector("#searchResults");
  fullSyncBtn = container.querySelector(
    "#fullSyncBtn",
  ) as HTMLButtonElement | null;
  cancelSyncBtn = container.querySelector(
    "#cancelSync",
  ) as HTMLButtonElement | null;
  syncStatusEl = container.querySelector("#syncStatus");

  await loadState();

  performSearch("");

  if (fullSyncBtn) {
    fullSyncBtn.addEventListener("click", async () => {
      const reply = await browser.runtime.sendMessage({ type: "syncRepos" });
      if (reply?.alreadyRunning) {
        syncStatusEl!.textContent = "Sync already running";
      } else if (reply?.error) {
        syncStatusEl!.textContent = `Error: ${reply.error}`;
      }
    });
  }

  if (cancelSyncBtn) {
    cancelSyncBtn.addEventListener("click", () => {
      browser.runtime.sendMessage({ type: "cancelSync" });
      syncStatusEl!.textContent = "Cancelling...";
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        performSearch(searchInput!.value.trim());
      }, 150);
    });
  }
}

async function loadState() {
  const repos = await storage.getRepos();
  allRepos = Object.values(repos);

  if (allRepos.length > 0) {
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

  await loadSyncStatus();
}

async function loadSyncStatus() {
  const status = await browser.storage.session
    .get("syncStatus")
    .then((r) => r.syncStatus as SyncStatus | undefined);
  renderSyncStatus(status ?? { state: "idle" });
}

function renderSyncStatus(status: SyncStatus) {
  if (!fullSyncBtn || !cancelSyncBtn || !syncStatusEl) return;

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
      loadState().then(() => {
        const query = searchInput?.value.trim() ?? "";
        performSearch(query);
      });
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
      loadState().then(() => {
        const query = searchInput?.value.trim() ?? "";
        performSearch(query);
      });
      break;
  }
}

function hideAllEmpty() {
  if (!defaultEmpty || !readyEmpty || !searchEmpty) return;
  defaultEmpty.style.display = "none";
  readyEmpty.style.display = "none";
  searchEmpty.style.display = "none";
}

function showDefaultEmpty() {
  if (!defaultEmpty || !syncControls) return;
  hideAllEmpty();
  defaultEmpty.style.display = "";
  syncControls.style.display = "";
}

function showReadyEmpty() {
  if (!readyEmpty || !syncControls) return;
  hideAllEmpty();
  readyEmpty.style.display = "";
  syncControls.style.display = "";
}

function showSearchEmpty() {
  if (!searchEmpty || !syncControls) return;
  hideAllEmpty();
  searchEmpty.style.display = "";
  syncControls.style.display = "none";
}

function showResults() {
  if (!syncControls) return;
  hideAllEmpty();
  syncControls.style.display = "none";
}

function performSearch(query: string) {
  if (!query) {
    searchResults!.innerHTML = "";
    if (allRepos.length === 0) {
      showDefaultEmpty();
    } else {
      showReadyEmpty();
    }
    return;
  }

  if (!fuse) {
    searchResults!.innerHTML = "";
    showSearchEmpty();
    return;
  }

  const results = fuse.search(query, { limit: 20 });
  if (results.length > 0) {
    showResults();
  } else {
    showSearchEmpty();
  }
  searchResults!.innerHTML = results
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

export function onSyncProgress(status: SyncStatus): void {
  renderSyncStatus(status);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
