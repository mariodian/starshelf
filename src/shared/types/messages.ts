// Messages sent from content script to background
export interface RepoStarClickedMessage {
  type: "repoStarClicked";
  payload: {
    owner: string;
    repo: string;
    action: "star" | "unstar";
  };
}

export interface RegenerateCategoryMessage {
  type: "regenerateCategory";
  payload: {
    owner: string;
    repo: string;
    previousCategories: string[];
    currentCategory: string;
  };
}

// Messages sent from popup to background
export interface StartBatchMessage {
  type: "startBatch";
}

export interface CancelBatchMessage {
  type: "cancelBatch";
}

export interface SyncReposMessage {
  type: "syncRepos";
}

export interface CancelSyncMessage {
  type: "cancelSync";
}

// Messages sent from background to content script / popup
export interface UpdateStarStatusMessage {
  type: "updateStarStatus";
  payload: {
    owner: string;
    repo: string;
    status: "categorizing" | "saved" | "error" | "removed";
    category?: string;
    error?: string;
    previousCategories?: string[];
  };
}

export type BatchStatus =
  | { state: "idle" }
  | { state: "running"; current: number; currentRepo: string; message?: string }
  | {
      state: "done";
      categorized: number;
      skipped: number;
      completedAt: string;
    }
  | { state: "error"; message: string }
  | {
      state: "cancelled";
      categorized: number;
      skipped: number;
      completedAt: string;
    };

export interface BatchProgressMessage {
  type: "batchProgress";
  payload: BatchStatus;
}

export type SyncStatus =
  | { state: "idle" }
  | { state: "running"; synced: number; message?: string }
  | { state: "done"; synced: number; completedAt: string }
  | { state: "error"; message: string }
  | { state: "cancelled"; synced: number; completedAt: string };

export interface SyncProgressMessage {
  type: "syncProgress";
  payload: SyncStatus;
}

// Union types for sender and receiver
export type ContentMessage = RepoStarClickedMessage | RegenerateCategoryMessage;
export type PopupMessage =
  | StartBatchMessage
  | CancelBatchMessage
  | SyncReposMessage
  | CancelSyncMessage;
export type BackgroundMessage =
  | UpdateStarStatusMessage
  | BatchProgressMessage
  | SyncProgressMessage;
export type RuntimeMessage = ContentMessage | PopupMessage;
