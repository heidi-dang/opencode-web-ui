import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "../../packages/app/src/app"
import { ServerConnection } from "../../packages/app/src/context/server"
import { type Platform, PlatformProvider } from "../../packages/app/src/context/platform"
import { createBrowserDraftStore } from "../../packages/app/src/utils/draft-store"
import "../../packages/app/src/index.css"

const root = document.getElementById("root")

const platform: Platform = {
  platform: "web",
  draftStore: createBrowserDraftStore(),
  version: "1.0.0-review",
  openExternal: () => {},
  restart: async () => {},
  notify: async () => {},
  getDefaultServer: async () => ServerConnection.Key.make("http://localhost:3000"),
  setDefaultServer: () => {},
}

if (root instanceof HTMLElement) {
  render(
    () => (
      <PlatformProvider value={platform}>
        <AppBaseProviders locale="en">
          <AppInterface defaultServer={ServerConnection.Key.make("http://localhost:3000")} />
        </AppBaseProviders>
      </PlatformProvider>
    ),
    root
  )
}
