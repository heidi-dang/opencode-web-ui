import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  messageUpdated,
  partUpdated,
  setupTimeline,
  status,
  textPart,
  userID,
  userMessage,
  type TimelineMessage,
} from "../performance/timeline-stability/fixture"

test.describe("session interruption", () => {
  test("stops an admitted execution, reconciles inactivity, and accepts the next prompt", async ({ page }) => {
    let active = false
    let interruptCount = 0
    const prompts: unknown[] = []
    const liveMessages: TimelineMessage[] = [userMessage(), assistantMessage()]

    const timeline = await setupTimeline(page, {
      protocol: "v2",
      messages: liveMessages,
      pageMessages: () => ({ items: liveMessages }),
      activeSessions: () => (active ? { [liveMessages[0]!.info.sessionID]: { type: "running" } } : {}),
      onPrompt: ({ body }) => {
        prompts.push(body)
        active = true
      },
      onInterrupt: () => {
        interruptCount++
        // The endpoint acknowledges first; authoritative active-state
        // reconciliation observes the execution for one poll, then sees it
        // disappear. This prevents the test from passing via a fake local IDLE.
        active = true
        setTimeout(() => {
          active = false
        }, 250)
      },
    })

    const editor = page.locator('[data-component="prompt-input"]')
    const submit = page.locator('[data-action="prompt-submit"]')
    const stop = page.getByRole("button", { name: "Stop" })

    await page.locator('[data-action="prompt-model"]').click()
    await page.getByRole("button", { name: /Claude Opus 4\.6/ }).last().click()

    const send = async (text: string, responseID: string, responseText: string) => {
      const request = page.waitForRequest(
        (current) => current.method() === "POST" && current.url().includes("/prompt"),
      )
      await editor.fill(text)
      await submit.click()
      await request
      await expect(stop).toBeVisible()

      const promptBody = prompts.at(-1)
      const promptID =
        promptBody && typeof promptBody === "object" && "id" in promptBody && typeof promptBody.id === "string"
          ? promptBody.id
          : undefined
      if (!promptID) throw new Error(`prompt body: ${JSON.stringify(promptBody)}`)

      const partID = `prt_${responseID}_text`
      const assistant = assistantMessage([textPart(partID, responseText)], {
        parentID: userID,
        completed: false,
      })
      assistant.info.id = responseID
      assistant.info.parentID = promptID
      assistant.parts.forEach((part) => {
        part.messageID = responseID
      })
      liveMessages.push(assistant)
      await timeline.send(status("busy"))
      await timeline.send(messageUpdated(assistant.info))
      await timeline.send(partUpdated(assistant.parts[0]!))
      await expect(page.getByText(responseText, { exact: true }).first()).toBeVisible()
      return { promptID, assistant }
    }

    await send("long running prompt", "msg_stop_partial_assistant", "Partial answer before stop")

    const interrupt = page.waitForRequest(
      (current) =>
        current.method() === "POST" && current.url().includes(`/session/${liveMessages[0]!.info.sessionID}/interrupt`),
    )
    await stop.click()
    await expect(stop).toBeDisabled()
    await interrupt
    await expect.poll(() => interruptCount).toBe(1)
    await expect(stop).toHaveCount(0)
    await expect(page.getByText("Partial answer before stop", { exact: true }).first()).toBeVisible()

    const second = await send("follow up after stop", "msg_after_stop_assistant", "Follow-up response")
    active = false
    await timeline.send(
      messageUpdated({ ...second.assistant.info, time: { ...second.assistant.info.time, completed: Date.now() } }),
    )
    await timeline.send(status("idle"))
    await expect(stop).toHaveCount(0)
    expect(prompts).toHaveLength(2)
    expect(interruptCount).toBe(1)
  })
})
