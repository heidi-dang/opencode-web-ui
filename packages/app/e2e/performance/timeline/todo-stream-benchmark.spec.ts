import { benchmark, expect } from "../benchmark"
import {
  assistantMessage,
  setupTimeline,
  textPart,
  todoUpdated,
  userMessage,
} from "../timeline-stability/fixture"

benchmark("measures todo event-to-DOM latency during an active stream", async ({ page, report }) => {
  const timeline = await setupTimeline(page, {
    settings: { newLayoutDesigns: true },
    messages: [
      userMessage(),
      assistantMessage([textPart("prt_todo_benchmark", "Streaming while todos update")], { completed: false }),
    ],
  })
  const dock = page.locator('[data-component="session-todo-dock"]')
  const active = [
    { content: "Receive the live todo", status: "completed", priority: "high" },
    { content: "Paint the current task", status: "in_progress", priority: "high" },
  ]
  const completed = active.map((todo) => ({ ...todo, status: "completed" }))

  const openStart = await page.evaluate(() => performance.now())
  await timeline.send(todoUpdated(active))
  await expect(dock).toBeVisible()
  await expect(dock.locator('[data-state="in_progress"]')).toHaveCount(1)
  const openObservedMs = await page.evaluate((start) => performance.now() - start, openStart)

  const updateStart = await page.evaluate(() => performance.now())
  await timeline.send(todoUpdated(completed))
  await expect(dock.locator('[data-state="in_progress"]')).toHaveCount(0)
  const completionObservedMs = await page.evaluate((start) => performance.now() - start, updateStart)

  report(
    { openObservedMs, completionObservedMs },
    { todos: active.length, newLayoutDesigns: true },
  )
})
