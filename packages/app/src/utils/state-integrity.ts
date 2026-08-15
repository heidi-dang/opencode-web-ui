/**
 * Complex State Graph Integrity & Concurrent Safety Utilities (Fixes 366-380)
 */

import { batch, createMemo, createSignal, onCleanup, startTransition } from "solid-js";

/**
 * 366. Micro-Task State Batching
 * Wraps rapid-fire dispatches inside Solid's batch() boundary to avoid intermediate frame re-renders.
 */
export function microTaskBatch(fn: () => void): void {
  batch(fn);
}

export class BatchedStateQueue {
  private queue: Array<() => void> = [];
  private scheduled = false;

  public enqueue(update: () => void): void {
    this.queue.push(update);
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => {
        const tasks = [...this.queue];
        this.queue = [];
        this.scheduled = false;
        batch(() => {
          tasks.forEach((task) => task());
        });
      });
    }
  }
}

/**
 * 367. Non-Blocking Transition Wrapping
 * Wraps heavy state updates inside Solid's startTransition so typing remains smooth.
 */
export function wrapNonBlockingTransition(callback: () => void): Promise<void> {
  return new Promise((resolve) => {
    startTransition(() => {
      callback();
      resolve();
    });
  });
}

/**
 * 368. Immutable Draft Mutation Protections
 * Structural guard to ensure global store instances are never modified directly without immutability wrappers.
 */
export function deepFreezeImmutableDraft<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const val = (obj as Record<string, unknown>)[prop];
    if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreezeImmutableDraft(val);
    }
  });
  return obj;
}

export function guardImmutableMutation<T>(state: T, mutator: (draft: T) => void): T {
  const clone = JSON.parse(JSON.stringify(state));
  mutator(clone);
  return deepFreezeImmutableDraft(clone);
}

/**
 * 369. State Restoration Validation
 * Runs a schema verification function on persisted local storage state before restoring it on application boot.
 */
export function validateAndRestorePersistedState<T>(
  storageKey: string,
  validator: (data: unknown) => data is T,
  fallback: T
): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (validator(parsed)) {
      return parsed;
    }
    console.warn(`[state-validation] Stored schema for ${storageKey} failed validation, falling back to default.`);
    localStorage.removeItem(storageKey);
    return fallback;
  } catch (err) {
    console.error(`[state-validation] Failed to parse stored state for ${storageKey}`, err);
    return fallback;
  }
}

/**
 * 370. Recursive Component Recursion Cap Guard
 */
export function checkRecursionCap(depth: number, maxDepth: number = 20): boolean {
  if (depth > maxDepth) {
    console.warn(`[recursion-guard] Maximum recursion depth of ${maxDepth} exceeded.`);
    return false;
  }
  return true;
}

/**
 * 372. Form Field Touch State Reset
 */
export class FormFieldTouchStateTracker {
  private touchedFields = new Set<string>();
  private dirtyFields = new Set<string>();

  public touch(field: string): void {
    this.touchedFields.add(field);
  }

  public markDirty(field: string): void {
    this.dirtyFields.add(field);
  }

  public isTouched(field: string): boolean {
    return this.touchedFields.has(field);
  }

  public isDirty(field: string): boolean {
    return this.dirtyFields.has(field);
  }

  public reset(): void {
    this.touchedFields.clear();
    this.dirtyFields.clear();
  }
}

/**
 * 373. Suspense Fallback Flickering Elimination
 * Adds a minimum display duration to loading indicators so fast responses don't produce brief, distracting flashes.
 */
export function createFlickerFreeLoadingState(
  isLoadingAccessor: () => boolean,
  minDisplayDurationMs: number = 200
) {
  const [showLoading, setShowLoading] = createSignal(isLoadingAccessor());
  let startTime = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return createMemo(() => {
    const rawLoading = isLoadingAccessor();
    if (rawLoading) {
      if (!startTime) startTime = Date.now();
      setShowLoading(true);
    } else if (startTime) {
      const elapsed = Date.now() - startTime;
      const remaining = minDisplayDurationMs - elapsed;
      if (remaining > 0) {
        if (!timer) {
          timer = setTimeout(() => {
            setShowLoading(false);
            startTime = 0;
            timer = undefined;
          }, remaining);
        }
      } else {
        setShowLoading(false);
        startTime = 0;
      }
    }
    return showLoading();
  });
}

/**
 * 374. State Machine Invalid Transition Guards
 */
export class FiniteStateMachineGuard<S extends string> {
  private currentState: S;
  private allowedTransitions: Record<S, S[]>;

  constructor(initialState: S, allowedTransitions: Record<S, S[]>) {
    this.currentState = initialState;
    this.allowedTransitions = allowedTransitions;
  }

  public get state(): S {
    return this.currentState;
  }

  public transitionTo(nextState: S): boolean {
    const validTargets = this.allowedTransitions[this.currentState] ?? [];
    if (!validTargets.includes(nextState)) {
      console.warn(
        `[fsm-guard] Invalid transition attempted from '${this.currentState}' to '${nextState}'. Allowed: [${validTargets.join(", ")}]`
      );
      return false;
    }
    this.currentState = nextState;
    return true;
  }
}

/**
 * 376. Synthetic Event Persistence Safeguards
 */
export function safeExtractEventData<E extends { target?: unknown; currentTarget?: unknown; value?: unknown }>(
  event: E
): { value?: string; target?: unknown } {
  const target = event.target || event.currentTarget;
  const value = target && typeof target === "object" && "value" in target ? String((target as { value: unknown }).value) : undefined;
  return { target, value };
}

/**
 * 378. Re-render Count Threshold Guard (Dev Mode)
 */
export class RenderCountGuard {
  private componentName: string;
  private renderCount = 0;
  private lastResetTime = Date.now();
  private maxRendersPerSec: number;

  constructor(componentName: string, maxRendersPerSec: number = 50) {
    this.componentName = componentName;
    this.maxRendersPerSec = maxRendersPerSec;
  }

  public recordRender(): void {
    const now = Date.now();
    if (now - this.lastResetTime > 1000) {
      this.renderCount = 0;
      this.lastResetTime = now;
    }
    this.renderCount++;
    if (this.renderCount > this.maxRendersPerSec) {
      console.warn(
        `[render-guard] Component '${this.componentName}' rendered ${this.renderCount} times in 1 second, exceeding limit of ${this.maxRendersPerSec}. Check for infinite loops.`
      );
    }
  }
}

/**
 * 380. Controlled Input Value Alignment
 * Ensures input value string and internal state remain aligned during key repeat events.
 */
export function alignInputValue(currentValue: string, newValue: string): string {
  if (currentValue === newValue) return currentValue;
  return newValue;
}
