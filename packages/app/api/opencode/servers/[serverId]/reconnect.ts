import type { NextApiRequest, NextApiResponse } from "next"
import { getServer, probeRegisteredServer, publicServer, updateServerHealth } from "@/server/server-registry"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" })
  const server = await getServer(String(req.query.serverId))
  if (!server) return res.status(404).json({ error: "SERVER_NOT_FOUND" })
  const probe = await probeRegisteredServer(server)
  const next = await updateServerHealth(server.id, { state: probe.state, protocol: probe.protocol })
  return res.status(probe.state === "READY" ? 200 : 502).json({ server: publicServer(next || server), ...probe })
}
