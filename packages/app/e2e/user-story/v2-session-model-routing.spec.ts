import { expect, test, type Page } from "@playwright/test"
import {
  assistantMessage,
  messageUpdated,
  partUpdated,
  session,
  setupTimeline,
  status,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

const providerID = "fixture-provider"
const modelIDs = ["model-a", "model-b", "model-c", "model-d"] as const
const provider = {
  all: [
    {
      id: providerID,
      name: "Fixture Provider",
      models: Object.fromEntries(
        modelIDs.map((id) => [id, { id, name: `Model ${id.slice(-1).toUpperCase()}`, limit: { context: 200_000 } }]),
      ),
    },
  ],
  connected: [providerID],
  default: { providerID, modelID: modelIDs[0] },
}

function history() {
  const user = userMessage()
  user.info.model = { providerID, modelID: modelIDs[0] }
  const assistant = assistantMessage([textPart("prt_initial", "Initial response from Model A")])
  assistant.info.providerID = providerID
  assistant.info.modelID = modelIDs[0]
  return [user, assistant]
}

function modelFromBody(body: unknown) {
  if (!body || typeof body !== "object" || !("model" in body)) return undefined
  const model = body.model
  if (!model || typeof model !== "object" || !("id" in model) || typeof model.id !== "string") return undefined
  return model.id
}

async function selectModel(page: Page, modelID: string) {
  await page.locator('[data-action="prompt-model"]').click()
  const option = page.locator(`[data-option-key="${providerID}:${modelID}"]`)
  await expect(option).toBeVisible()
  await option.click()
}

test.describe("v2 session model routing", () => {
  test("waits for an existing-session switch before prompt and preserves turn attribution", async ({ page }) => {
    const switches: string[] = []
    const prompts: unknown[] = []
    let releaseSwitch!: () => void
    let holdSwitch = true
    const timeline = await setupTimeline(page, {
      protocol: "v2",
      provider,
      sessions: [session()],
      messages: history(),
      onSwitchModel: async ({ body }) => {
        const modelID = modelFromBody(body)
        if (!modelID) throw new Error(`missing model in switch request: ${JSON.stringify(body)}`)
        switches.push(modelID)
        if (holdSwitch) await new Promise<void>((resolve) => (releaseSwitch = resolve))
      },
      onPrompt: ({ body }) => prompts.push(body),
    })
    const editor = page.locator('[data-component="prompt-input"]')
    const submit = page.locator('[data-action="prompt-submit"]')
    await expect(page.locator('[data-action="prompt-model"]')).toContainText("Model A")

    const switchRequest = page.waitForRequest(
      (request) => request.method() === "POST" && /\/session\/[^/]+\/model(?:\?|$)/.test(request.url()),
    )
    await selectModel(page, "model-b")
    await switchRequest

    await editor.fill("prompt after switching")
    await submit.click()
    await expect.poll(() => prompts).toHaveLength(0)

    releaseSwitch()
    await expect.poll(() => prompts).toHaveLength(1)
    expect(switches).toEqual(["model-b"])
    const promptBody = prompts[0]
    expect(promptBody).not.toHaveProperty("model")

    const promptID = typeof promptBody === "object" && promptBody && "id" in promptBody ? promptBody.id : undefined
    if (typeof promptID !== "string") throw new Error("prompt admission did not include an id")
    const assistant = assistantMessage([textPart("prt_model_b", "Response from Model B")], {
      id: "msg_model_b",
      parentID: promptID,
    })
    assistant.info.providerID = providerID
    assistant.info.modelID = "model-b"
    await timeline.send(status("busy"))
    await timeline.send(messageUpdated(assistant.info))
    await timeline.send(partUpdated(assistant.parts[0]!))
    await expect(page.getByText("Response from Model B", { exact: true })).toBeVisible()

    holdSwitch = false
    await selectModel(page, "model-c")
    await expect.poll(() => switches).toEqual(["model-b", "model-c"])
    await editor.fill("second prompt")
    await submit.click()
    await expect.poll(() => prompts).toHaveLength(2)
    const secondPrompt = prompts[1]
    const secondID = typeof secondPrompt === "object" && secondPrompt && "id" in secondPrompt ? secondPrompt.id : undefined
    if (typeof secondID !== "string") throw new Error("second prompt admission did not include an id")
    const secondAssistant = assistantMessage([textPart("prt_model_c", "Response from Model C")], {
      id: "msg_model_c",
      parentID: secondID,
    })
    secondAssistant.info.providerID = providerID
    secondAssistant.info.modelID = "model-c"
    await timeline.send(messageUpdated(secondAssistant.info))
    await timeline.send(partUpdated(secondAssistant.parts[0]!))
    await expect(page.getByText("Response from Model C", { exact: true })).toBeVisible()
    await expect(page.getByText("Response from Model B", { exact: true })).toBeVisible()
  })

  test("does not submit when the session model switch fails", async ({ page }) => {
    const prompts: unknown[] = []
    await setupTimeline(page, {
      protocol: "v2",
      provider,
      sessions: [session()],
      messages: history(),
      onSwitchModel: async () => {
        throw new Error("fixture model unavailable")
      },
      onPrompt: ({ body }) => prompts.push(body),
    })

    await selectModel(page, "model-b")
    await expect(page.locator('[data-action="prompt-model"]')).toContainText("Model A")
    await page.locator('[data-component="prompt-input"]').fill("must not execute")
    await page.locator('[data-action="prompt-submit"]').click()
    await expect.poll(() => prompts).toHaveLength(0)
  })
})
