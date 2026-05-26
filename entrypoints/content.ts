import type { BackgroundMessage } from '@/shared/types/messages';

const STYLE_ID = 'star-categorizer-spinner';
const OVERLAY_ID = 'star-categorizer-overlay';

export default defineContentScript({
  matches: ['https://github.com/*'],
  main() {
    // Inject keyframe animation for the spinner
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
// Star button detection
// ---------------------------------------------------------------------------

let buttonObserver: MutationObserver | null = null;
let containerObserver: MutationObserver | null = null;
let lastStarred: boolean | null = null;
let currentRepo: { owner: string; repo: string } | null = null;

function findStarButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    'button[aria-label*="star" i], [data-testid="star-repo-button"], button[data-view-component="true"][value*="star" i]',
  );
}

function isStarred(btn: HTMLButtonElement): boolean {
  const text = (btn.textContent ?? '').toLowerCase();
  const aria = (btn.getAttribute('aria-label') ?? '').toLowerCase();

  // After starring the button reads "Unstar"
  if (text.includes('unstar') || aria.startsWith('unstar')) return true;
  // Before starring it says "Star"
  if (text.trim().startsWith('star') || aria.startsWith('star')) return false;

  // Heuristic: starred buttons often have a filled star or different styling
  const svg = btn.querySelector('svg');
  if (svg?.classList.contains('octicon-star-fill')) return true;
  if (svg?.classList.contains('octicon-star')) return false;

  // Fallback: check the form action
  const form = btn.closest('form');
  if (form) {
    const action = form.getAttribute('action') ?? '';
    if (action.includes('/unstar')) return true;
    if (action.includes('/star')) return false;
  }

  return false;
}

function checkButton(btn: HTMLButtonElement) {
  const nowStarred = isStarred(btn);

  if (lastStarred === null) {
    lastStarred = nowStarred;
    return;
  }

  if (nowStarred !== lastStarred) {
    lastStarred = nowStarred;
    const action = nowStarred ? 'star' : 'unstar';
    if (currentRepo) {
      browser.runtime.sendMessage({
        type: 'repoStarClicked',
        payload: { owner: currentRepo.owner, repo: currentRepo.repo, action },
      });
    }
  }
}

function parseRepoFromUrl(url: string) {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\/$/, '') };
}

function watchButton(btn: HTMLButtonElement) {
  if (buttonObserver) buttonObserver.disconnect();
  buttonObserver = new MutationObserver(() => checkButton(btn));
  buttonObserver.observe(btn, { attributes: true, childList: true, subtree: true });
  checkButton(btn);
}

function initWatcher() {
  if (buttonObserver) buttonObserver.disconnect();
  if (containerObserver) containerObserver.disconnect();
  lastStarred = null;
  currentRepo = parseRepoFromUrl(location.href);

  if (!currentRepo) return;

  const btn = findStarButton();
  if (btn) {
    watchButton(btn);
  }

  // Watch the page heading container where the star button lives;
  // GitHub may replace it entirely during Turbo navigation.
  const container =
    document.querySelector('.starring-container, [data-testid="star-button-container"]') ??
    document.querySelector('#repository-container-header');

  if (container) {
    containerObserver = new MutationObserver(() => {
      const newBtn = findStarButton();
      if (newBtn) watchButton(newBtn);
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
      el.textContent = `\u2605 ${category || 'Categorized'}`;
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
      el.textContent = 'Unstarred \u2014 category removed';
      el.style.color = '#9ca3af';
      el.style.opacity = '1';
      setTimeout(() => {
        el!.style.opacity = '0';
      }, 2000);
      break;
  }
}
