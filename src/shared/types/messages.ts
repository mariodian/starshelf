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

// Messages sent from background to content script
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

// Union types for sender and receiver
export type ContentMessage = RepoStarClickedMessage | RegenerateCategoryMessage;
export type BackgroundMessage = UpdateStarStatusMessage;
