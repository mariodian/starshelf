import { storage } from "@/shared/storage";
import type { BackgroundMessage } from "@/shared/types/messages";
import type { TabId } from "./shared";
import { createTabButton } from "./shared";
import { renderSettingsTab, initSettingsTab } from "./settings";
import {
  renderCategorizeTab,
  initCategorizeTab,
  onBatchProgress,
} from "./categorize";
import { renderSearchTab, initSearchTab, onSyncProgress } from "./search";

const tabContent = document.getElementById("tabContent")!;
const tabNav = document.getElementById("tabNav")!;

let activeTab: TabId | null = null;
const tabButtons = new Map<TabId, HTMLButtonElement>();

async function getDefaultTab(): Promise<TabId> {
  const settings = await storage.getSettings();
  const provider = settings.providers[settings.activeProvider];
  const hasAllTokens = !!settings.githubToken && !!provider?.apiKey;
  return hasAllTokens ? "search" : "settings";
}

function showTab(tabId: TabId): void {
  if (activeTab === tabId) return;
  activeTab = tabId;

  tabButtons.forEach((btn, id) => {
    btn.classList.toggle("active", id === tabId);
  });

  tabContent.innerHTML = "";

  switch (tabId) {
    case "search": {
      const el = renderSearchTab();
      tabContent.appendChild(el);
      initSearchTab();
      break;
    }
    case "categorize": {
      const el = renderCategorizeTab();
      tabContent.appendChild(el);
      initCategorizeTab();
      break;
    }
    case "settings": {
      const el = renderSettingsTab();
      tabContent.appendChild(el);
      initSettingsTab();
      break;
    }
  }

  tabContent.scrollTop = 0;
}

function buildTabNav(): void {
  const tabs: TabId[] = ["search", "categorize", "settings"];
  for (const id of tabs) {
    const btn = createTabButton(id, false);
    btn.addEventListener("click", () => showTab(id));
    tabNav.appendChild(btn);
    tabButtons.set(id, btn);
  }
}

browser.runtime.onMessage.addListener((msg: BackgroundMessage) => {
  if (msg.type === "batchProgress") {
    onBatchProgress(msg.payload);
  } else if (msg.type === "syncProgress") {
    onSyncProgress(msg.payload);
  }
});

buildTabNav();
getDefaultTab().then((tabId) => showTab(tabId));
