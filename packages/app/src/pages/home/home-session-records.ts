import type { Session } from "@opencode-ai/sdk/v2/client"
import type { LocalProject } from "@/context/layout"
import { displayName, projectForSession } from "@/pages/layout/helpers"
import { pathKey } from "@/utils/path-key"

export type HomeSessionRecord = { session: Session; project: LocalProject; projectName: string }

export function buildHomeSessionRecords(input: {
  sessions: () => Session[]
  projectDirectories: () => string[]
  projects: () => LocalProject[]
  projectByID: () => Map<string, LocalProject>
}) {
  const directories = new Set(input.projectDirectories().map(pathKey))
  const knownProjects = input.projectByID()
  const sessions = input.sessions().filter(
    (session) => directories.has(pathKey(session.directory)) || knownProjects.has(session.projectID),
  )
  const projectsList = input.projects()
  const projectByDir = new Map<string, LocalProject>()
  for (const project of projectsList) {
    for (const directory of [project.worktree, ...(project.sandboxes ?? [])]) {
      const key = pathKey(directory)
      if (!projectByDir.has(key)) projectByDir.set(key, project)
    }
  }
  return [...new Map(sessions.map((session) => [session.id, session] as const)).values()]
    .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
    .flatMap((session) => {
      const project = projectByDir.get(pathKey(session.directory)) ?? projectForSession(session, projectsList, knownProjects)
      return project ? [{ session, project, projectName: displayName(project) }] : []
    })
}
