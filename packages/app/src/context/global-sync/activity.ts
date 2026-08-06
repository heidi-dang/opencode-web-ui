const MEANINGFUL_ACTIVITY_EVENTS = new Set([
  "message.part.delta",
  "todo.progress",
  "message.part.updated",
  "message.created",
  "message.updated",
  "todo.created",
  "todo.updated",
])

export function meaningfulActivitySessionID(event: { type: string; properties?: unknown }): string | undefined {
  if (!MEANINGFUL_ACTIVITY_EVENTS.has(event.type)) return
  const properties = event.properties as { sessionID?: string; info?: { sessionID?: string } }
  return properties.sessionID ?? properties.info?.sessionID
}
