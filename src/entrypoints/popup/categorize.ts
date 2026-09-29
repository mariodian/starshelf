import type { BatchStatus } from "@/shared/types/messages";
import { h, setJobButtons } from "./shared";

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

  setJobButtons(startBtn, cancelBtn, status.state === "running");

  switch (status.state) {
    case "idle":
      statusText.textContent = "Ready";
      break;

    case "running":
      if (status.message) {
        statusText.textContent = status.message;
      } else if (status.current > 0) {
        statusText.textContent = `Processing ${status.current}: ${status.currentRepo}`;
      } else {
        statusText.textContent = "Starting...";
      }
      break;

    case "done":
      statusText.textContent = `Done! ${status.categorized} categorized, ${status.skipped} skipped`;
      break;

    case "error":
      statusText.textContent = `Error: ${status.message}`;
      break;

    case "cancelled":
      statusText.textContent = `Stopped. ${status.categorized} categorized, ${status.skipped} skipped.`;
      break;
  }
}

export function onBatchProgress(status: BatchStatus): void {
  renderStatus(status);
}
