import type { BatchStatus } from "@/shared/types/messages";
import { h } from "./shared";

let root: HTMLElement | null = null;
let startBtn: HTMLButtonElement | null = null;
let cancelBtn: HTMLButtonElement | null = null;
let statusText: HTMLParagraphElement | null = null;

export function renderCategorizeTab(): HTMLElement {
  root = h("div", { id: "categorizeTab" });
  root.innerHTML = `
      <h2>Batch Categorize</h2>
      <p>
        Categorize all uncategorized starred repos into Star Lists. The
        process runs in the background so you can close this popup.
      </p>
      <div class="sync-controls">
        <button id="startBatch">Categorize</button>
        <button id="cancelBatch" class="danger" style="display: none">
          Cancel
        </button>
        <p id="batchStatus" class="hint">Ready</p>
      </div>
  `;
  return root;
}

export function initCategorizeTab(): void {
  const container = root ?? document;
  startBtn = container.querySelector("#startBatch") as HTMLButtonElement;
  cancelBtn = container.querySelector("#cancelBatch") as HTMLButtonElement;
  statusText = container.querySelector("#batchStatus") as HTMLParagraphElement;

  loadStatus();

  startBtn.addEventListener("click", async () => {
    const reply = await browser.runtime.sendMessage({ type: "startBatch" });
    if (reply?.alreadyRunning) {
      statusText!.textContent = "Batch already running";
    } else if (reply?.error) {
      statusText!.textContent = `Error: ${reply.error}`;
    }
  });

  cancelBtn.addEventListener("click", () => {
    browser.runtime.sendMessage({ type: "cancelBatch" });
    statusText!.textContent = "Cancelling...";
  });
}

function loadStatus() {
  browser.storage.session
    .get("batchStatus")
    .then((r) => r.batchStatus as BatchStatus | undefined)
    .then((status) => renderStatus(status ?? { state: "idle" }));
}

function renderStatus(status: BatchStatus) {
  if (!startBtn || !cancelBtn || !statusText) return;

  switch (status.state) {
    case "idle":
      startBtn.style.display = "";
      cancelBtn.style.display = "none";
      statusText.textContent = "Ready";
      break;

    case "running":
      startBtn.style.display = "none";
      cancelBtn.style.display = "";
      if (status.message) {
        statusText.textContent = status.message;
      } else if (status.current > 0) {
        statusText.textContent = `Processing ${status.current}: ${status.currentRepo}`;
      } else {
        statusText.textContent = "Starting...";
      }
      break;

    case "done":
      startBtn.style.display = "";
      cancelBtn.style.display = "none";
      statusText.textContent = `Done! ${status.categorized} categorized, ${status.skipped} skipped`;
      break;

    case "error":
      startBtn.style.display = "";
      cancelBtn.style.display = "none";
      statusText.textContent = `Error: ${status.message}`;
      break;

    case "cancelled":
      startBtn.style.display = "";
      cancelBtn.style.display = "none";
      statusText.textContent = `Stopped. ${status.categorized} categorized, ${status.skipped} skipped.`;
      break;
  }
}

export function onBatchProgress(status: BatchStatus): void {
  renderStatus(status);
}
