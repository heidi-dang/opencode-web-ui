import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode-ai/client/promise"
import { createV2SessionReducer } from "./server-session-v2-reducer"

const event = (input: object) => input as OpenCodeEvent
const base = { created: 1, location: { directory: "/repo" }, durable: { aggregateID: "ses_1", seq: 1, version: 1 } }

describe("v2 session reducer", () => {
  test("projects promoted input and streaming assistant content", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
      return result
    }

    apply({
      ...base,
      id: "evt_admitted",
      type: "session.input.admitted",
      data: {
        sessionID: "ses_1",
        inputID: "msg_user",
        input: { type: "user", delivery: "steer", data: { text: "hello" } },
      },
    })
    apply({
      ...base,
      id: "evt_promoted",
      type: "session.input.promoted",
      data: { sessionID: "ses_1", inputID: "msg_user" },
    })
    apply({
      ...base,
      id: "evt_step",
      type: "session.step.started",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...base,
      id: "evt_text_start",
      type: "session.text.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0 },
    })
    apply({
      ...base,
      id: "evt_text_delta",
      type: "session.text.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0, delta: "hel" },
    })
    apply({
      ...base,
      id: "evt_text_end",
      type: "session.text.ended",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0, text: "hello" },
    })

    expect(messages[0]).toMatchObject({ id: "msg_user", type: "user", text: "hello" })
    expect(messages[1]).toMatchObject({
      id: "msg_assistant",
      type: "assistant",
      content: [{ type: "text", text: "hello" }],
    })
  })

  test("folds tool, retry, and completion events", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
    }

    apply({
      ...base,
      id: "evt_step",
      type: "session.step.started",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...base,
      id: "evt_tool_start",
      type: "session.tool.input.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", name: "bash" },
    })
    apply({
      ...base,
      id: "evt_tool_delta",
      type: "session.tool.input.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", delta: "{}" },
    })
    apply({
      ...base,
      id: "evt_tool_called",
      type: "session.tool.called",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", input: {}, executed: true },
    })
    apply({
      ...base,
      id: "evt_tool_success",
      type: "session.tool.success",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        metadata: {},
        content: [{ type: "text", text: "done" }],
        executed: true,
      },
    })
    apply({
      ...base,
      id: "evt_retry",
      type: "session.retry.scheduled",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        attempt: 2,
        at: 10,
        error: { type: "ProviderError", message: "retry" },
      },
    })
    apply({ ...base, id: "evt_done", type: "session.execution.succeeded", data: { sessionID: "ses_1" } })

    expect(messages[0]).toMatchObject({
      type: "assistant",
      retry: undefined,
      content: [{ type: "tool", id: "call_1", state: { status: "completed", content: [{ text: "done" }] } }],
    })
  })

  test("requests hydration when promotion admission was missed", () => {
    const result = createV2SessionReducer().reduce(
      [],
      event({
        ...base,
        id: "evt_promoted",
        type: "session.input.promoted",
        data: { sessionID: "ses_1", inputID: "msg_user" },
      }),
    )

    expect(result).toMatchObject({ sessionID: "ses_1", missing: "msg_user", touched: [] })
  })

  test("keeps the assistant reference when a tool event is a no-op", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
      return result
    }

    apply({
      ...base,
      id: "evt_step",
      type: "session.step.started",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...base,
      id: "evt_tool_start",
      type: "session.tool.input.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", name: "bash" },
    })
    apply({
      ...base,
      id: "evt_tool_called",
      type: "session.tool.called",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", input: {}, executed: true },
    })
    apply({
      ...base,
      id: "evt_tool_success",
      type: "session.tool.success",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        metadata: {},
        content: [{ type: "text", text: "done" }],
        executed: true,
      },
    })

    const before = messages[0]
    const noop = apply({
      ...base,
      id: "evt_tool_progress_after_complete",
      type: "session.tool.progress",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", metadata: {} },
    })

    expect(noop?.touched).toEqual(["msg_assistant"])
    expect(messages).toHaveLength(1)
    // The tool is already completed, so the event must not recreate the
    // assistant message; projectV2 can skip the reconcile/normalize pass.
    expect(messages[0]).toBe(before)
    expect(noop?.messages[0]).toBe(before)
  })

  test("recreates the assistant reference when a running tool receives progress", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
      return result
    }

    apply({
      ...base,
      id: "evt_step",
      type: "session.step.started",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...base,
      id: "evt_tool_start",
      type: "session.tool.input.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", name: "bash" },
    })
    apply({
      ...base,
      id: "evt_tool_called",
      type: "session.tool.called",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", input: {}, executed: true },
    })

    const before = messages[0]
    const changed = apply({
      ...base,
      id: "evt_tool_progress_running",
      type: "session.tool.progress",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", metadata: { percent: 50 } },
    })

    expect(changed?.touched).toEqual(["msg_assistant"])
    expect(changed?.messages[0]).not.toBe(before)
    expect(changed?.messages[0]).toMatchObject({
      content: [
        {
          type: "tool",
          id: "call_1",
          state: { status: "running", metadata: { percent: 50 } },
        },
      ],
    })
  })
})
