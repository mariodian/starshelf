import type {
  BackgroundMessage,
  UpdateStarStatusMessage,
} from "@/shared/types/messages";
import { logger } from "@/shared/logger";
import { parseRepoFromUrl } from "@/shared/github";
import "../shared/overlay.css";

const WRAPPER_ID = "starshelf-wrapper";
const OVERLAY_ID = "starshelf-overlay";

const TIMEOUTS = {
  saved: 5000,
  error: 5000,
  removed: 2000,
};

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let currentFadeMs = 0;
let hoverActive = false;
const rejectedCategories = new Map<string, string[]>();

function reponame(owner: string, repo: string) {
  return `${owner}/${repo}`;
}

function h(
  tag: string,
  attrs: Record<string, string>,
  ...children: (string | HTMLElement)[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const child of children) {
    el.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
  return el;
}

export default defineContentScript({
  matches: ["https://github.com/*"],
  main() {
    let currentUrl = location.href;
    const navObserver = new MutationObserver(() => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        initWatcher();
      }
    });
    navObserver.observe(document, { subtree: true, childList: true });

    initWatcher();

    browser.runtime.onMessage.addListener((msg: BackgroundMessage) => {
      if (msg.type === "updateStarStatus") {
        showOverlay((msg as UpdateStarStatusMessage).payload);
      }
    });
  },
});

// ---------------------------------------------------------------------------
// Star button click detection — tracks button state to infer intent.
// MutationObserver callbacks fire in microtask *after* the click, so
// `wasStarred` holds the pre-click value when our handler runs.
// Comparing pre-click state to the (already-mutated) DOM gives us intent.
// ---------------------------------------------------------------------------

let containerObserver: MutationObserver | null = null;
let currentRepo: { owner: string; repo: string } | null = null;
let wasStarred = false;

function findStarButton(): HTMLButtonElement | null {
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    '.starring-container button[type="submit"]',
  );
  for (const btn of buttons) {
    if (btn.offsetParent !== null) return btn;
  }
  return null;
}

function readButtonState(btn: HTMLButtonElement): boolean {
  return (
    btn.getAttribute("data-hydro-click")?.includes("UNSTAR_BUTTON") ?? false
  );
}

function onStarClick(event: Event) {
  if (!currentRepo) return;
  const btn = event.currentTarget as HTMLButtonElement;
  const current = readButtonState(btn);

  logger.log(
    "[stars] click | wasStarred:",
    wasStarred,
    "| current:",
    current,
    "| classList:",
    btn.className,
  );

  const action = current ? "unstar" : "star";
  logger.log(`[stars] action: ${action} | sending message`);

  browser.runtime.sendMessage({
    type: "repoStarClicked",
    payload: {
      owner: currentRepo.owner,
      repo: currentRepo.repo,
      action,
    },
  });
}

let clickListenerAttached = false;

function watchButton(btn: HTMLButtonElement) {
  if (clickListenerAttached) return;
  clickListenerAttached = true;
  wasStarred = readButtonState(btn);
  logger.log(
    "[stars] watchButton | wasStarred:",
    wasStarred,
    "| classList:",
    btn.className
      .split(" ")
      .filter((c) => c.startsWith("starred") || c.startsWith("Button")),
  );
  btn.addEventListener("click", onStarClick);
}

function initWatcher() {
  if (containerObserver) containerObserver.disconnect();
  clickListenerAttached = false;
  currentRepo = parseRepoFromUrl(location.href);

  logger.log(
    "[stars] initWatcher | url:",
    location.href,
    "| currentRepo:",
    currentRepo,
  );

  if (!currentRepo) return;

  const btn = findStarButton();
  logger.log("[stars] initWatcher | found button:", !!btn);
  if (btn) {
    watchButton(btn);
  }

  // Watch the container where the star button lives;
  // GitHub may replace it entirely during Turbo navigation.
  const container =
    document.querySelector(
      '.starring-container, [data-testid="star-button-container"]',
    ) ?? document.querySelector("#repository-container-header");

  if (container) {
    containerObserver = new MutationObserver(() => {
      const newBtn = findStarButton();
      logger.log("[stars] container mutated | found new btn:", !!newBtn);
      if (newBtn) {
        clickListenerAttached = false;
        watchButton(newBtn);
      }
    });
    containerObserver.observe(container, { childList: true, subtree: true });
  }
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

function startFadeTimer(ms: number) {
  currentFadeMs = ms;
  if (hoverActive) return;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (hoverActive) return;
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.style.opacity = "0";
    const refreshBtn = document.getElementById("starshelf-refresh-btn");
    if (refreshBtn) refreshBtn.style.opacity = "0";
    saveTimeout = null;
    currentFadeMs = 0;
  }, ms);
}

function showOverlay(payload: UpdateStarStatusMessage["payload"]) {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }

  let wrapper = document.getElementById(WRAPPER_ID);
  if (!wrapper) {
    wrapper = document.createElement("div");
    wrapper.id = WRAPPER_ID;
    wrapper.addEventListener("mouseenter", () => {
      hoverActive = true;
      if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
      }
    });
    wrapper.addEventListener("mouseleave", () => {
      hoverActive = false;
      if (currentFadeMs > 0) {
        startFadeTimer(currentFadeMs);
      }
    });
  }

  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    wrapper.appendChild(overlay);
  }

  let refreshBtn = wrapper.querySelector<HTMLButtonElement>(
    "#starshelf-refresh-btn",
  );
  if (!refreshBtn) {
    refreshBtn = document.createElement("button");
    refreshBtn.id = "starshelf-refresh-btn";
    refreshBtn.title = "Regenerate name";
    refreshBtn.textContent = "\u21BB";
    refreshBtn.addEventListener("click", onRefreshClick);
    wrapper.appendChild(refreshBtn);
  }

  const starBtn = findStarButton();
  if (starBtn) {
    const parent = starBtn.closest("li") || starBtn.parentElement;
    if (parent && wrapper.parentElement !== parent) {
      parent.appendChild(wrapper);
      parent.style.position = "relative";
    }
    wrapper.style.top = `${starBtn.offsetHeight + 4}px`;
  }

  const { status, category, error } = payload;

  switch (status) {
    case "categorizing":
      refreshBtn.style.display = "none";
      overlay.replaceChildren(
        h(
          "div",
          {
            style: "white-space:nowrap;display:flex;align-items:center;gap:6px",
          },
          h("span", { id: "starshelf-spinner" }),
          h("span", { id: "starshelf-text" }, "Shelving..."),
        ),
      );
      overlay.style.color = "var(--starshelf-link)";
      overlay.style.opacity = "1";
      break;
    case "saved":
      refreshBtn.style.display = "";
      refreshBtn.style.opacity = "";
      refreshBtn.dataset.owner = payload.owner;
      refreshBtn.dataset.repo = payload.repo;
      refreshBtn.dataset.category = category || "";
      overlay.replaceChildren(
        h(
          "div",
          { style: "white-space:nowrap;display:flex;align-items:center" },
          h(
            "span",
            { id: "starshelf-saved-text" },
            category || "Added to list",
          ),
        ),
      );
      overlay.style.color = "var(--starshelf-link)";
      overlay.style.opacity = "1";
      startFadeTimer(TIMEOUTS.saved);
      break;
    case "error":
      refreshBtn.style.display = "none";
      overlay.textContent = `\u26A0 ${error || "Error"}`;
      overlay.style.color = "var(--starshelf-error)";
      overlay.style.opacity = "1";
      startFadeTimer(TIMEOUTS.error);
      break;
    case "removed":
      refreshBtn.style.display = "none";
      overlay.textContent = "Unstarred";
      overlay.style.color = "var(--starshelf-muted)";
      overlay.style.opacity = "1";
      startFadeTimer(TIMEOUTS.removed);
      break;
  }
}

function onRefreshClick(event: Event) {
  const btn = event.currentTarget as HTMLButtonElement;
  const owner = btn.dataset.owner;
  const repo = btn.dataset.repo;
  const category = btn.dataset.category;
  if (!owner || !repo || !category) return;

  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }

  const fullName = reponame(owner, repo);
  const rejected = rejectedCategories.get(fullName) || [];
  rejected.push(category);
  rejectedCategories.set(fullName, rejected);

  btn.style.display = "none";
  currentFadeMs = 0;

  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    overlay.innerHTML = `
<div style="white-space: nowrap; display: flex; align-items: center; gap: 6px;">
  <span id="starshelf-spinner"></span>
  <span id="starshelf-text">Regenerating...</span>
</div>
`;
    overlay.style.opacity = "1";
  }

  browser.runtime.sendMessage({
    type: "regenerateCategory",
    payload: {
      owner,
      repo,
      previousCategories: rejected.slice(0, -1),
      currentCategory: category,
    },
  });
}
