import type { Todo } from "@opencode-ai/sdk/v2/client"

export function todoSignature(todos: readonly Todo[]) {
  return JSON.stringify(todos.map((todo) => [todo.content, todo.status, todo.priority]))
}
