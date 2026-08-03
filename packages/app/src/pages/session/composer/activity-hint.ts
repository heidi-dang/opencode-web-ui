import type { Part } from "@opencode-ai/sdk/v2/client"
import type { ActivityHint } from "@/pages/session/composer/streaming-status-bar"

/**
 * Map a v2 Part to the streaming status bar activity hint.
 *
 * Tool parts are classified by tool name: shell-command tools surface as
 * "shell", file/read/search tools as "file", everything else as "tool".
 * Step lifecycle parts surface as "step", text parts as "text". Everything
 * else (reasoning, snapshots, retries, compaction, unknown) is "thinking".
 */
function toolActivity(tool: string): "shell" | "file" | "tool" {
  const name = tool.toLowerCase()
  if (name.includes("command") || name.includes("bash") || name.includes("shell")) return "shell"
  if (
    name.includes("read") ||
    name.includes("grep") ||
    name.includes("write") ||
    name.includes("edit") ||
    name.includes("patch") ||
    name.includes("glob") ||
    name.includes("search")
  ) {
    return "file"
  }
  return "tool"
}

export function activityHintFromPart(part: Part | undefined): ActivityHint {
  if (!part) return "thinking"
  switch (part.type) {
    case "tool":
      return toolActivity(part.tool)
    case "step-start":
    case "step-finish":
      return "step"
    case "text":
      return "text"
    case "file":
    case "patch":
      return "file"
    case "agent":
    case "subtask":
      return "tool"
    case "reasoning":
    case "snapshot":
    case "retry":
    case "compaction":
    default:
      return "thinking"
  }
}
