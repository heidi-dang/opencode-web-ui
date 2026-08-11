import { describe, expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import {
  BatchedStateQueue,
  FiniteStateMachineGuard,
  FormFieldTouchStateTracker,
  RenderCountGuard,
  alignInputValue,
  checkRecursionCap,
  createFlickerFreeLoadingState,
  deepFreezeImmutableDraft,
  guardImmutableMutation,
  microTaskBatch,
  safeExtractEventData,
  validateAndRestorePersistedState,
  wrapNonBlockingTransition,
} from "../src/utils/state-integrity";

describe("Round 9: Complex State Graph Integrity & Concurrent Safety (Fixes 366–380)", () => {

  test("366: microTaskBatch and BatchedStateQueue execute updates atomically", async () => {
    createRoot((dispose) => {
      const [count, setCount] = createSignal(0);

      microTaskBatch(() => {
        setCount(1);
        setCount(2);
        setCount(3);
      });

      expect(count()).toBe(3);
      dispose();
    });

    const queue = new BatchedStateQueue();
    let val = 0;
    queue.enqueue(() => { val += 1; });
    queue.enqueue(() => { val += 2; });

    await new Promise((r) => setTimeout(r, 20));
    expect(val).toBe(3);
  });

  test("367: wrapNonBlockingTransition executes callback without blocking UI thread", async () => {
    let executed = false;
    await wrapNonBlockingTransition(() => {
      executed = true;
    });
    expect(executed).toBe(true);
  });

  test("368: deepFreezeImmutableDraft prevents accidental inline store mutations", () => {
    const draft = { user: { name: "Alice", preferences: { theme: "dark" } } };
    const frozen = deepFreezeImmutableDraft(draft);

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.user)).toBe(true);
    expect(Object.isFrozen(frozen.user.preferences)).toBe(true);

    const updated = guardImmutableMutation(frozen, (d) => {
      d.user.name = "Bob";
    });

    expect(updated.user.name).toBe("Bob");
    expect(frozen.user.name).toBe("Alice");
  });

  test("369: validateAndRestorePersistedState restores valid state and rejects invalid schema", () => {
    const validData = JSON.stringify({ version: 1, theme: "light" });
    const invalidData = JSON.stringify({ version: "wrong-type" });

    const validator = (data: unknown): data is { version: number; theme: string } => {
      return (
        typeof data === "object" &&
        data !== null &&
        typeof (data as any).version === "number" &&
        typeof (data as any).theme === "string"
      );
    };

    localStorage.setItem("test-settings", validData);
    const restored = validateAndRestorePersistedState("test-settings", validator, { version: 1, theme: "dark" });
    expect(restored.theme).toBe("light");

    localStorage.setItem("test-settings", invalidData);
    const fallback = validateAndRestorePersistedState("test-settings", validator, { version: 1, theme: "dark" });
    expect(fallback.theme).toBe("dark");

    localStorage.removeItem("test-settings");
  });

  test("370: checkRecursionCap flags recursion depth exceeding maximum guard", () => {
    const origWarn = console.warn;
    let warnCalls: string[] = [];
    console.warn = (...args: any[]) => { warnCalls.push(args.join(" ")); };

    expect(checkRecursionCap(5, 10)).toBe(true);
    expect(checkRecursionCap(15, 10)).toBe(false);

    expect(warnCalls.some((msg) => msg.includes("Maximum recursion depth of 10 exceeded"))).toBe(true);
    console.warn = origWarn;
  });

  test("372: FormFieldTouchStateTracker manages touched/dirty state and resets cleanly", () => {
    const tracker = new FormFieldTouchStateTracker();

    tracker.touch("email");
    tracker.markDirty("email");

    expect(tracker.isTouched("email")).toBe(true);
    expect(tracker.isDirty("email")).toBe(true);
    expect(tracker.isTouched("password")).toBe(false);

    tracker.reset();

    expect(tracker.isTouched("email")).toBe(false);
    expect(tracker.isDirty("email")).toBe(false);
  });

  test("373: createFlickerFreeLoadingState holds display for minimum duration to prevent flickering", async () => {
    await new Promise((resolve) => {
      createRoot((dispose) => {
        const [loading, setLoading] = createSignal(true);
        const isVisible = createFlickerFreeLoadingState(loading, 100);

        expect(isVisible()).toBe(true);

        // Rapid completion
        setLoading(false);
        expect(isVisible()).toBe(true); // Still showing due to min display duration

        setTimeout(() => {
          expect(isVisible()).toBe(false);
          dispose();
          resolve(true);
        }, 150);
      });
    });
  });

  test("374: FiniteStateMachineGuard permits valid transitions and warns on invalid transitions", () => {
    const origWarn = console.warn;
    let warnCalls: string[] = [];
    console.warn = (...args: any[]) => { warnCalls.push(args.join(" ")); };

    type State = "Idle" | "Loading" | "Success" | "Error";
    const fsm = new FiniteStateMachineGuard<State>("Idle", {
      Idle: ["Loading"],
      Loading: ["Success", "Error"],
      Success: ["Idle"],
      Error: ["Idle", "Loading"],
    });

    expect(fsm.state).toBe("Idle");

    // Invalid transition: Idle -> Success
    const invalidSuccess = fsm.transitionTo("Success");
    expect(invalidSuccess).toBe(false);
    expect(fsm.state).toBe("Idle");
    expect(warnCalls.some((msg) => msg.includes("Invalid transition attempted from 'Idle' to 'Success'"))).toBe(true);

    // Valid transition: Idle -> Loading -> Success
    expect(fsm.transitionTo("Loading")).toBe(true);
    expect(fsm.state).toBe("Loading");
    expect(fsm.transitionTo("Success")).toBe(true);
    expect(fsm.state).toBe("Success");

    console.warn = origWarn;
  });

  test("376: safeExtractEventData safely extracts values from synthetic events without pooling issues", () => {
    const mockEvent = {
      target: { value: "User Input" },
      currentTarget: { value: "User Input" },
    };

    const extracted = safeExtractEventData(mockEvent);
    expect(extracted.value).toBe("User Input");
  });

  test("378: RenderCountGuard warns when render threshold per second is exceeded", () => {
    const origWarn = console.warn;
    let warnCalls: string[] = [];
    console.warn = (...args: any[]) => { warnCalls.push(args.join(" ")); };

    const guard = new RenderCountGuard("TestComponent", 5);

    for (let i = 0; i < 6; i++) {
      guard.recordRender();
    }

    expect(warnCalls.some((msg) => msg.includes("Component 'TestComponent' rendered 6 times in 1 second"))).toBe(true);
    console.warn = origWarn;
  });

  test("380: alignInputValue returns aligned value during rapid key repetition", () => {
    expect(alignInputValue("abc", "abcd")).toBe("abcd");
    expect(alignInputValue("same", "same")).toBe("same");
  });
});
