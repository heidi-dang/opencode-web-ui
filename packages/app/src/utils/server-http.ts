import type { ServerConnection } from "@/context/server"

export const DEFAULT_USERNAME = "opencode"

/**
 * Build a ServerConnection.HttpBase with OPTIONAL credentials.
 * Credentials are attached ONLY when a password exists:
 * - URL only            -> { url } (no username, no password, no auth header)
 * - password + blank username -> { url, username: DEFAULT_USERNAME, password }
 * - username + blank password -> { url } (treated as unauthenticated; username is NOT stored)
 */
export function buildServerHttpBase(input: {
  url: string
  username?: string
  password?: string
}): ServerConnection.HttpBase {
  const { url, password } = input
  if (!password) return { url }
  const username = (input.username ?? "").trim() || DEFAULT_USERNAME
  return { url, username, password }
}
