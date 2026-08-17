import type { NextApiRequest, NextApiResponse } from "next"
import { listServers, publicServer, registerServer, updateServerHealth } from "@/server/server-registry"

async function body(req: NextApiRequest) {
  if (typeof req.body === "object" && req.body) return req.body
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === "GET") return res.status(200).json({ servers: (await listServers()).map(publicServer) })
    if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" })
    const input = await body(req)
    const server = await registerServer({
      name: typeof input.name === "string" ? input.name : undefined,
      baseUrl: typeof input.baseUrl === "string" ? input.baseUrl : "",
      username: typeof input.username === "string" ? input.username : undefined,
      password: typeof input.password === "string" ? input.password : undefined,
      enabled: input.enabled !== false,
    })
    let state: "READY" | "UNHEALTHY" = "UNHEALTHY"
    let protocol: "v1" | "v2" | undefined
    try {
      const target = new URL(server.baseUrl)
      const response = await fetch(new URL(`${target.pathname.replace(/\/$/, "")}/global/health`, target.origin), {
        headers: server.password ? { Authorization: `Basic ${Buffer.from(`${server.username || "opencode"}:${server.password}`).toString("base64")}` } : undefined,
        signal: AbortSignal.timeout(5000),
      })
      if (response.ok) {
        state = "READY"
        protocol = response.headers.get("x-opencode-version") ? "v2" : "v1"
      }
    } catch {
      // Registration remains durable so the user can retry from the server fleet.
    }
    const updated = await updateServerHealth(server.id, { state, protocol })
    return res.status(201).json({ server: publicServer(updated || server), reachability: state === "READY" ? "SERVER_READY" : "SERVER_REGISTERED_BUT_UNREACHABLE" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "REGISTRATION_FAILED"
    const status = ["UNSUPPORTED_URL_SCHEME", "UNSAFE_SERVER_URL", "INVALID_SERVER_URL", "DUPLICATE_SERVER_URL"].includes(message) ? 400 : 500
    return res.status(status).json({ error: message })
  }
}
