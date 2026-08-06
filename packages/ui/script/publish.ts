#!/usr/bin/env bun

export const ALLOWED_CHANNELS = ["dev", "beta", "latest", "canary"] as const
export type Channel = typeof ALLOWED_CHANNELS[number]

export function validateChannel(channel: string | undefined): Channel {
  const ch = channel || "dev"
  if (!ALLOWED_CHANNELS.includes(ch as Channel)) {
    throw new Error(`Invalid OPENCODE_CHANNEL: "${ch}". Allowed channels are: ${ALLOWED_CHANNELS.join(", ")}`)
  }
  return ch as Channel
}

if (import.meta.main) {
  const channel = validateChannel(process.env.OPENCODE_CHANNEL)
  const { $ } = await import("bun")
  const { rm } = await import("node:fs/promises")
  const { fileURLToPath } = await import("node:url")
  const { pack } = await import("./pack")

  process.chdir(fileURLToPath(new URL("..", import.meta.url)))

  const pkg = (await Bun.file("package.json").json()) as { name: string; version: string }
  const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`

  if ((await $`npm view ${pkg.name}@${pkg.version} version`.nothrow()).exitCode === 0) {
    console.log(`already published ${pkg.name}@${pkg.version}`)
    process.exit(0)
  }

  try {
    await $`bun run typecheck`
    await $`bun run test`
    await pack()
    await $`npm publish ${tarball} --access public --tag ${channel}`
  } finally {
    await rm(tarball, { force: true })
  }
}
