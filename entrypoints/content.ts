import type { BackgroundMessage } from '@/shared/types/messages';

const STYLE_ID = 'star-categorizer-spinner';
const OVERLAY_ID = 'star-categorizer-overlay';

export default defineContentScript({
  matches: ['https://github.com/*'],
  main() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent =
        '@keyframes star-cat-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }

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
      if (msg.type === 'updateStarStatus') {
        showOverlay(msg.payload);
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
  return btn.getAttribute('data-hydro-click')?.includes('UNSTAR_BUTTON') ?? false;
}

function parseRepoFromUrl(url: string) {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\/$/, '') };
}

function onStarClick(event: Event) {
  if (!currentRepo) return;
  const btn = event.currentTarget as HTMLButtonElement;
  const current = readButtonState(btn);

  console.log('[stars] click | wasStarred:', wasStarred, '| current:', current, '| classList:', btn.className);

  // current === true means the UNSTAR button was clicked; we only act on star actions
  if (current) {
    console.log('[stars] ignoring — unstar action');
    return;
  }

  console.log('[stars] action: star | sending message');

  browser.runtime.sendMessage({
    type: 'repoStarClicked',
    payload: {
      owner: currentRepo.owner,
      repo: currentRepo.repo,
      action: 'star',
    },
  });
}

let clickListenerAttached = false;

function watchButton(btn: HTMLButtonElement) {
  if (clickListenerAttached) return;
  clickListenerAttached = true;
  wasStarred = readButtonState(btn);
  console.log('[stars] watchButton | wasStarred:', wasStarred, '| classList:', btn.className.split(' ').filter(c => c.startsWith('starred') || c.startsWith('Button')));
  btn.addEventListener('click', onStarClick);
}

function initWatcher() {
  if (containerObserver) containerObserver.disconnect();
  clickListenerAttached = false;
  currentRepo = parseRepoFromUrl(location.href);

  console.log('[stars] initWatcher | url:', location.href, '| currentRepo:', currentRepo);

  if (!currentRepo) return;

  const btn = findStarButton();
  console.log('[stars] initWatcher | found button:', !!btn);
  if (btn) {
    watchButton(btn);
  }

  // Watch the container where the star button lives;
  // GitHub may replace it entirely during Turbo navigation.
  const container =
    document.querySelector('.starring-container, [data-testid="star-button-container"]') ??
    document.querySelector('#repository-container-header');

  if (container) {
    containerObserver = new MutationObserver(() => {
      const newBtn = findStarButton();
      console.log('[stars] container mutated | found new btn:', !!newBtn);
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

function showOverlay(payload: BackgroundMessage['payload']) {
  let el = document.getElementById(OVERLAY_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    Object.assign(el.style, {
      position: 'absolute',
      zIndex: '9999',
      background: '#1a1a2e',
      color: '#e94560',
      padding: '6px 12px',
      borderRadius: '6px',
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      pointerEvents: 'none',
      transition: 'opacity 0.3s',
      whiteSpace: 'nowrap',
      opacity: '0',
    });
    document.body.appendChild(el);
  }

  const btn = findStarButton();
  if (btn) {
    const r = btn.getBoundingClientRect();
    el.style.top = `${r.bottom + window.scrollY + 4}px`;
    el.style.left = `${r.left + window.scrollX}px`;
  }

  const { status, category, error } = payload;

  switch (status) {
    case 'categorizing':
      el.innerHTML =
        '<span style="display:inline-block;width:12px;height:12px;border:2px solid #e94560;border-top-color:transparent;border-radius:50%;animation:star-cat-spin 1s linear infinite;margin-right:6px;vertical-align:middle;"></span>Categorizing...';
      el.style.color = '#e94560';
      el.style.opacity = '1';
      break;
    case 'saved':
      el.textContent = `\u2605 ${category || 'Added to list'}`;
      el.style.color = '#4ade80';
      el.style.opacity = '1';
      setTimeout(() => {
        el!.style.opacity = '0';
      }, 3000);
      break;
    case 'error':
      el.textContent = `\u26A0 ${error || 'Error'}`;
      el.style.color = '#ef4444';
      el.style.opacity = '1';
      setTimeout(() => {
        el!.style.opacity = '0';
      }, 5000);
      break;
    case 'removed':
      el.textContent = 'Unstarred \u2014 removed';
      el.style.color = '#9ca3af';
      el.style.opacity = '1';
      setTimeout(() => {
        el!.style.opacity = '0';
      }, 2000);
      break;
  }
}
