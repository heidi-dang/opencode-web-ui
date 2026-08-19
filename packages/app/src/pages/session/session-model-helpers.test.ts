import { describe, expect, test } from "bun:test"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { resetSessionModel, restorePromptModel, serverSessionSelection, syncPromptModel, syncSessionModel } from "./session-model-helpers"

const message = (input?: { agent?: string; model?: UserMessage["model"] }) =>
  ({
    id: "msg",
    sessionID: "session",
    role: "user",
    time: { created: 1 },
    agent: input?.agent ?? "build",
    model: input?.model ?? { providerID: "anthropic", modelID: "claude-sonnet-4" },
  }) as UserMessage

describe("syncSessionModel", () => {
  test("restores the last message through session state", () => {
    const calls: unknown[] = []

    syncSessionModel(
      {
        session: {
          restore(value) {
            calls.push(value)
          },
          reset() {},
        },
      },
      message({ model: { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "high" } }),
    )

    expect(calls).toEqual([
      message({ model: { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "high" } }),
    ])
  })
})

describe("resetSessionModel", () => {
  test("clears draft session state", () => {
    const calls: string[] = []

    resetSessionModel({
      session: {
        reset() {
          calls.push("reset")
        },
        restore() {},
      },
    })

    expect(calls).toEqual(["reset"])
  })
})

describe("syncPromptModel", () => {
  test("stores the effective session model in prompt state", () => {
    const calls: unknown[] = []

    syncPromptModel(
      {
        model: {
          current: () => ({ id: "claude-sonnet-4", provider: { id: "anthropic" } }),
          set() {},
          variant: { current: () => "high", set() {} },
        },
      },
      {
        model: {
          current: () => undefined,
          set: (model) => calls.push(model),
        },
      },
    )

    expect(calls).toEqual([{ providerID: "anthropic", modelID: "claude-sonnet-4", variant: "high" }])
  })

  test("does not rewrite an unchanged prompt model", () => {
    const calls: unknown[] = []
    const model = { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "high" }

    syncPromptModel(
      {
        model: {
          current: () => ({ id: model.modelID, provider: { id: model.providerID } }),
          set() {},
          variant: { current: () => model.variant, set() {} },
        },
      },
      {
        model: {
          current: () => model,
          set: (value) => calls.push(value),
        },
      },
    )

    expect(calls).toEqual([])
  })
})

describe("restorePromptModel", () => {
  test("restores the persisted prompt model into session selection", () => {
    const calls: unknown[] = []
    const restored = restorePromptModel(
      {
        model: {
          current: () => ({ id: "gpt", provider: { id: "openai" } }),
          set: (model) => calls.push(model),
          variant: {
            current: () => undefined,
            set: (variant) => calls.push(variant),
          },
        },
      },
      {
        model: {
          current: () => ({ providerID: "anthropic", modelID: "claude", variant: "high" }),
          set() {},
        },
      },
    )

    expect(restored).toBe(true)
    expect(calls).toEqual([{ providerID: "anthropic", modelID: "claude" }, "high"])
  })

  test("does nothing without a persisted prompt model", () => {
    const calls: unknown[] = []
    const restored = restorePromptModel(
      {
        model: {
          current: () => ({ id: "gpt", provider: { id: "openai" } }),
          set: (model) => calls.push(model),
          variant: {
            current: () => undefined,
            set: (variant) => calls.push(variant),
          },
        },
      },
      {
        model: {
          current: () => undefined,
          set() {},
        },
      },
    )

    expect(restored).toBe(false)
    expect(calls).toEqual([])
  })
})

describe("serverSessionSelection", () => {
  test("prefers the latest server-confirmed model and agent switch", () => {
    const selection = serverSessionSelection({
      info: {
        agent: "build",
        model: { id: "model-a", providerID: "provider-a", variant: "balanced" },
      },
      messages: [
        { id: "agent-1", type: "agent-switched", agent: "review", time: { created: 1 } },
        {
          id: "model-1",
          type: "model-switched",
          model: { id: "model-b", providerID: "provider-b", variant: "fast" },
          previous: { id: "model-a", providerID: "provider-a" },
          time: { created: 2 },
        },
      ] as never,
    })

    expect(selection).toEqual({
      agent: "review",
      model: { providerID: "provider-b", modelID: "model-b", variant: "fast" },
      variant: "fast",
    })
  })

  test("falls back to authoritative session metadata when no switch event exists", () => {
    expect(
      serverSessionSelection({
        info: { agent: "build", model: { id: "model-a", providerID: "provider-a" } },
        messages: [],
      }),
    ).toEqual({
      agent: "build",
      model: { providerID: "provider-a", modelID: "model-a", variant: undefined },
      variant: null,
    })
  })
})
