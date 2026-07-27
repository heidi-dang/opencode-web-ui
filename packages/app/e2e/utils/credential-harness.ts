import { fileURLToPath } from "url"
import path from "path"
import fs from "fs"
import type { Page } from "@playwright/test"

/**
 * Transform the production `server-credentials.ts` source (TypeScript) into
 * plain JavaScript that can be evaluated in a browser context.
 *
 * Strips:
 *  - `export` keyword
 *  - Function parameter type annotations  (`param: Type`)
 *  - Function return type annotations       (`): Type {`)
 *  - Variable declaration type annotations  (`const name: Type =`)
 *  - The `namespace CredentialTesting { … }` block entirely
 *
 * Appends a `window.__credentialModule` assignment so the public API is
 * reachable from `page.evaluate()` calls.
 */
function toBrowserSource(source: string): string {
  let code = source

  // -- 1. Strip `export ` keyword -------------------------------------------
  code = code.replace(/^export /gm, "")

  // -- 2. Remove `namespace CredentialTesting { … }` with brace counting -----
  const nsMarker = "namespace CredentialTesting {"
  const nsStart = code.indexOf("\n" + nsMarker)
  if (nsStart !== -1) {
    let depth = 1
    let endIdx = nsStart + 1 + nsMarker.length // +1 for the leading \n
    for (let i = endIdx; i < code.length; i++) {
      if (code[i] === "{") depth++
      if (code[i] === "}") {
        depth--
        if (depth === 0) {
          endIdx = i + 1
          break
        }
      }
    }
    code = code.slice(0, nsStart) + code.slice(endIdx)
  }

  // -- 3. Strip function declaration type annotations -----------------------
  const lines = code.split("\n")
  code = lines
    .map((line) => {
      // Only process lines that are a function declaration
      if (!/^\s*function\s+\w+\s*\(/.test(line)) return line

      const openParen = line.indexOf("(")
      const closeParen = line.lastIndexOf(")")
      if (openParen === -1 || closeParen === -1) return line

      const before = line.slice(0, openParen)
      const params = line.slice(openParen + 1, closeParen)
      const after = line.slice(closeParen + 1)

      // `serverUrl: string` → `serverUrl`
      const cleanParams = params.replace(/:\s*[^,)]+/g, "")

      // `): Type {` → `) {`
      const lastBrace = after.lastIndexOf("{")
      if (lastBrace !== -1) {
        const returnPart = after.slice(0, lastBrace).trim()
        if (returnPart.startsWith(":")) {
          return `${before}(${cleanParams})${after.slice(lastBrace)}`
        }
      }

      return `${before}(${cleanParams})${after}`
    })
    .join("\n")

  // -- 4. Strip variable declaration type annotations -----------------------
  // `const keys: string[] =` → `const keys =`
  code = code.replace(
    /\b(const|let|var)\s+(\w+)\s*:\s*([^=\n]+?)\s*=/g,
    "$1 $2 =",
  )

  // -- 5. Attach public API to window so it's reachable from evaluate() -----
  code +=
    "\n;window.__credentialModule={" +
    "saveCredentials,getCredentials,clearCredentials,hasCredentials,runCredentialMigration};\n"

  return code
}

// ---------------------------------------------------------------------------
// In-memory cache: the production source is read and transformed once per
// process and then injected into every page via addInitScript.
// ---------------------------------------------------------------------------
let cachedScript: string | null = null

function loadHarnessScript(): string {
  if (cachedScript) return cachedScript

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const sourcePath = path.resolve(
    __dirname,
    "../../src/utils/server-credentials.ts",
  )
  const source = fs.readFileSync(sourcePath, "utf8")
  cachedScript = toBrowserSource(source)
  return cachedScript
}

/**
 * Inject the **actual production** `server-credentials` module into the
 * browser page via `page.addInitScript`.  The module is available as
 * `window.__credentialModule` across navigations / reloads.
 *
 * Must be called **before** the page is navigated (or immediately followed
 * by a reload) so the init-script takes effect.
 */
export async function installCredentialHarness(page: Page): Promise<void> {
  const script = loadHarnessScript()
  await page.addInitScript(script)
}

// ---------------------------------------------------------------------------
// Convenience wrappers – call the PRODUCTION functions in the browser context
// ---------------------------------------------------------------------------

export async function saveCredentialViaModule(
  page: Page,
  serverUrl: string,
  username: string,
  password: string,
): Promise<void> {
  await page.evaluate(
    ({ serverUrl, username, password }: {
      serverUrl: string
      username: string
      password: string
    }) => {
      (window as any).__credentialModule.saveCredentials(
        serverUrl,
        username,
        password,
      )
    },
    { serverUrl, username, password },
  )
}

export async function getCredentialViaModule(
  page: Page,
  serverUrl: string,
): Promise<{ username?: string; password?: string } | null> {
  return page.evaluate((serverUrl: string) => {
    return (window as any).__credentialModule.getCredentials(serverUrl)
  }, serverUrl)
}

export async function clearCredentialViaModule(
  page: Page,
  serverUrl: string,
): Promise<void> {
  await page.evaluate((serverUrl: string) => {
    (window as any).__credentialModule.clearCredentials(serverUrl)
  }, serverUrl)
}

export async function hasCredentialViaModule(
  page: Page,
  serverUrl: string,
): Promise<boolean> {
  return page.evaluate((serverUrl: string) => {
    return (window as any).__credentialModule.hasCredentials(serverUrl)
  }, serverUrl)
}
