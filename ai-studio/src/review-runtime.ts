import { ServerConnection } from "@/context/server";
import { type Platform } from "@/context/platform";
import { createBrowserDraftStore } from "@/utils/draft-store";

export const reviewPlatform: Platform = {
  platform: "web",
  draftStore: createBrowserDraftStore(),
  version: "1.0.0-review",
  openExternal: () => {},
  restart: async () => {},
  notify: async () => {},
  getDefaultServer: async () => ServerConnection.Key.make("review://local"),
  setDefaultServer: () => {},
};

export const REVIEW_SERVER: ServerConnection.Http = {
  type: "http",
  http: { url: "review://local" },
  id: "review-local",
  displayName: "Review Mode Server",
} as unknown as ServerConnection.Http;

export function initReviewMocks() {
  if (import.meta.env.VITE_APP_RUNTIME === "review") {
    // Intercept client creation by hooking into module overrides if we can, or just mock fetch
    console.log("Review mocks initialized.");
  }
}
