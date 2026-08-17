import type { NextApiRequest, NextApiResponse } from "next"
import { getServer, probeRegisteredServer, publicServer } from "@/server/server-registry"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const server = await getServer(String(req.query.serverId))
  if (!server) return res.status(404).json({ error: "SERVER_NOT_FOUND" })
  const probe = await probeRegisteredServer(server)
  return res.status(probe.state === "READY" ? 200 : 502).json({ server: publicServer(server), ...probe })
}
