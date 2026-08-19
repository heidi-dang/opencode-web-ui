import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { PlatformProvider } from "@/context/platform"
import { ServerConnection, normalizeServerUrl } from "@/context/server"
import { reviewPlatform, REVIEW_SERVER } from "./review-runtime"
import { mockFetchHandler } from "./review-mock-fetch"
import "@/index.css"

// Intercept global fetch
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const mocked = mockFetchHandler(input, init);
  if (mocked) return mocked;
  return originalFetch(input, init);
};

// Also we need to inject the mock server into local storage so it bootstraps correctly
const key = "opencode.settings.dat:servers";
if (!localStorage.getItem(key)) {
  localStorage.setItem(key, JSON.stringify([REVIEW_SERVER]));
}
localStorage.setItem("opencode.settings.dat:defaultServerUrl", REVIEW_SERVER.http.url);

const root = document.getElementById("root")

if (root instanceof HTMLElement) {
  render(
    () => (
      <PlatformProvider value={reviewPlatform}>
        <AppBaseProviders locale="en">
          <AppInterface defaultServer={ServerConnection.Key.make(REVIEW_SERVER.http.url)} />
        </AppBaseProviders>
      </PlatformProvider>
    ),
    root
  )
}
