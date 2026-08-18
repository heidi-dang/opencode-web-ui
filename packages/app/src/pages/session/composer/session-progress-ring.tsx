import type { Todo } from "@opencode-ai/sdk/v2"
import { createMemo, Show } from "solid-js"
import { useLanguage } from "@/context/language"

export type TodoProgress = {
  total: number
  done: number
  fraction: number
}

/**
 * Keep progress semantics in one place. Cancelled work is terminal work: it
 * should not keep the session todo indicator looking permanently active.
 */
export function getTodoProgress(todos: readonly Pick<Todo, "status">[]): TodoProgress {
  const total = todos.length
  const done = todos.filter((todo) => todo.status === "completed" || todo.status === "cancelled").length
  return {
    total,
    done,
    fraction: total === 0 ? 0 : done / total,
  }
}

export function SessionProgressRing(props: { todos: readonly Todo[]; size?: number }) {
  const language = useLanguage()
  const progress = createMemo(() => getTodoProgress(props.todos))
  const size = () => props.size ?? 24
  const stroke = 2
  const radius = () => (size() - stroke) / 2
  const circumference = () => 2 * Math.PI * radius()
  const offset = () => circumference() * (1 - progress().fraction)
  const label = () =>
    language.t("session.todo.progress", {
      done: progress().done,
      total: progress().total,
    })

  return (
    <Show when={progress().total > 0}>
      <span
        class="progress-ring-container inline-flex shrink-0 items-center justify-center"
        classList={{ "progress-complete-burst": progress().total > 0 && progress().done === progress().total }}
        title={label()}
        aria-label={label()}
        role="img"
      >
        <svg
          width={size()}
          height={size()}
          viewBox={`0 0 ${size()} ${size()}`}
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx={size() / 2}
            cy={size() / 2}
            r={radius()}
            stroke="currentColor"
            stroke-width={stroke}
            class="text-v2-border-border-base"
          />
          <circle
            cx={size() / 2}
            cy={size() / 2}
            r={radius()}
            stroke="currentColor"
            stroke-width={stroke}
            stroke-linecap="round"
            class="progress-ring-circle text-v2-icon-icon-accent"
            style={{
              "stroke-dasharray": `${circumference()} ${circumference()}`,
              "stroke-dashoffset": offset(),
            }}
          />
        </svg>
      </span>
    </Show>
  )
}
