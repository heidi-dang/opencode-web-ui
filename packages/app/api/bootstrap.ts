import type { NextApiRequest, NextApiResponse } from "next"
import { getBootstrap } from "@/server/services/bootstrap-service"
export default async function handler(_req: NextApiRequest, res: NextApiResponse) { try { res.setHeader("cache-control", "private, max-age=0, stale-while-revalidate=5"); return res.status(200).json(await getBootstrap()) } catch { return res.status(503).json({ error: "BOOTSTRAP_UNAVAILABLE" }) } }
