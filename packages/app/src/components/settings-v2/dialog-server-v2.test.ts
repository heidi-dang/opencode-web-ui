import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

const source = readFileSync(new URL("./dialog-server-v2.tsx", import.meta.url), "utf8")

describe("server dialog lifecycle", () => {
  it("initializes add mode before the first reactive render", () => {
    expect(source).toContain('if (props.mode === "add") controller.startAdd()\n  if (props.mode === "edit" && props.server) controller.startEdit(props.server)')
    expect(source).not.toContain("onMount(() =>")
    expect(source).not.toContain("const [opened, setOpened]")
  })
})
