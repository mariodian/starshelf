import type { BatchStatus, BackgroundMessage } from "@/shared/types/messages";

export function initBatchUI() {
  const startBtn = document.getElementById("startBatch") as HTMLButtonElement;
  const cancelBtn = document.getElementById("cancelBatch") as HTMLButtonElement;
  const statusText = document.getElementById(
    "batchStatus",
  ) as HTMLParagraphElement;

  loadStatus();

  function loadStatus() {
    browser.storage.session
      .get("batchStatus")
      .then((r) => r.batchStatus as BatchStatus | undefined)
      .then((status) => renderStatus(status ?? { state: "idle" }));
  }

  function renderStatus(status: BatchStatus) {
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

  startBtn.addEventListener("click", async () => {
    const reply = await browser.runtime.sendMessage({ type: "startBatch" });
    if (reply?.alreadyRunning) {
      statusText.textContent = "Batch already running";
    } else if (reply?.error) {
      statusText.textContent = `Error: ${reply.error}`;
    }
  });

  cancelBtn.addEventListener("click", () => {
    browser.runtime.sendMessage({ type: "cancelBatch" });
    statusText.textContent = "Cancelling...";
  });

  browser.runtime.onMessage.addListener((msg: BackgroundMessage) => {
    if (msg.type === "batchProgress") {
      renderStatus(msg.payload);
    }
  });
}
