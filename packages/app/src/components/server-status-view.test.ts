import { describe, expect, test } from "bun:test"
import { resolveServerStatusView } from "./server-status-view"

describe("resolveServerStatusView", () => {
  test("maps a synchronized server to Connected", () => {
    expect(resolveServerStatusView({ visible: true, connection: "READY", healthy: true })).toEqual({
      visible: true,
      state: "connected",
      label: "Connected",
    })
  })

  test("maps recovery states without confusing them with session execution", () => {
    expect(resolveServerStatusView({ visible: true, connection: "RECONNECTING", healthy: false })).toMatchObject({
      visible: true,
      state: "reconnecting",
      label: "Reconnecting",
    })
    expect(resolveServerStatusView({ visible: true, connection: "STATE_RESYNCING", healthy: true })).toMatchObject({
      visible: true,
      state: "syncing",
      label: "Syncing",
    })
  })

  test("maps a failed server to Offline", () => {
    expect(resolveServerStatusView({ visible: true, connection: "UNHEALTHY", healthy: false })).toEqual({
      visible: true,
      state: "offline",
      label: "Offline",
    })
  })

  test("hides the control when the preference is disabled", () => {
    expect(resolveServerStatusView({ visible: false, connection: "READY", healthy: true })).toEqual({
      visible: false,
      state: "hidden",
      label: "",
    })
  })
})
