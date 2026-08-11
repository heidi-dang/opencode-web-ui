/**
 * Zero Bugs, Zero Console Warnings, 100% Stability & Resilience Utility Suite.
 * Sweep implementation for Rules 251 - 290.
 */

/**
 * Rule 290: Protect deep cloning and object merging utilities against prototype pollution vulnerabilities.
 * Strips keys like __proto__, constructor, and prototype.
 */
export function sanitizeObjectKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype"
}

/**
 * Rule 268 & 290: Safe JSON parsing wrapper with default fallback and prototype pollution protection.
 */
export function safeJsonParse<T>(json: unknown, fallback: T): T {
  if (typeof json !== "string" || !json.trim()) {
    return fallback
  }
  try {
    const parsed = JSON.parse(json, (key, value) => {
      if (!sanitizeObjectKey(key)) return undefined
      return value
    })
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

/**
 * Rule 273: Safe URL parsing guard.
 */
export function safeUrlParse(url: unknown, base?: string): URL | null {
  if (typeof url !== "string" || !url.trim()) return null
  try {
    return new URL(url, base)
  } catch {
    return null
  }
}

/**
 * Rule 273: Safe URI component encoding guard.
 */
export function safeEncodeURIComponent(str: unknown): string {
  if (typeof str !== "string") return ""
  try {
    return encodeURIComponent(str)
  } catch {
    // Handle unpaired surrogates safely
    return encodeURIComponent(str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ""))
  }
}

/**
 * Rule 278: Division by zero protection.
 */
export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  if (typeof numerator !== "number" || typeof denominator !== "number") return fallback
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return fallback
  if (denominator === 0) return fallback
  const result = numerator / denominator
  return Number.isFinite(result) ? result : fallback
}

/**
 * Rule 282: Unicode & Emoji precise character count using Array.from.
 */
export function safeUnicodeLength(str: unknown): number {
  if (typeof str !== "string") return 0
  return Array.from(str).length
}

/**
 * Rule 286: Hard maximum character boundary limits for inputs/textareas.
 */
export function safeTruncateString(str: unknown, maxLength: number): string {
  if (typeof str !== "string") return ""
  if (maxLength <= 0) return ""
  const chars = Array.from(str)
  if (chars.length <= maxLength) return str
  return chars.slice(0, maxLength).join("")
}

/**
 * Rule 281: Edge case input sanitization — removes zero-width spaces, control characters, and leading/trailing whitespace.
 */
export function sanitizeInputText(str: unknown, options: { trim?: boolean; stripControlChars?: boolean } = {}): string {
  if (typeof str !== "string") return ""
  let result = str
  if (options.stripControlChars ?? true) {
    // Strip zero-width characters and invisible control chars except \n and \t
    result = result.replace(/[\u200B-\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  }
  if (options.trim ?? false) {
    result = result.trim()
  }
  return result
}

/**
 * Rule 289: Special character file name sanitization.
 */
export function sanitizeFileName(fileName: unknown, fallback = "file"): string {
  if (typeof fileName !== "string" || !fileName.trim()) return fallback
  // Strip control chars, null bytes, path traversal slashes (\ and /)
  let clean = fileName
    .replace(/[\/\?<>\\:\*\|":]/g, "_")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()

  // Prevent leading dot hidden files or dot relative paths (. or ..)
  if (clean === "." || clean === "..") return fallback
  clean = clean.replace(/^\.+/, "")
  return clean || fallback
}

/**
 * Rule 283: Date parsing resilience — guards against Invalid Date.
 */
export function safeDateParse(dateInput: unknown, fallbackDate: Date = new Date()): Date {
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return dateInput
  }
  if (typeof dateInput === "number" || typeof dateInput === "string") {
    const parsed = new Date(dateInput)
    if (!isNaN(parsed.getTime())) {
      return parsed
    }
  }
  return fallbackDate
}

/**
 * Rule 267: Safe Array element indexing boundary guard.
 */
export function safeArrayElement<T>(arr: T[] | null | undefined, index: number, fallback?: T): T | undefined {
  if (!Array.isArray(arr) || index < 0 || index >= arr.length) {
    return fallback
  }
  return arr[index] ?? fallback
}

/**
 * Rule 287: Floating point rounding precision with Number.EPSILON.
 */
export function safeRound(num: number, decimals = 2): number {
  if (typeof num !== "number" || !Number.isFinite(num)) return 0
  const factor = Math.pow(10, decimals)
  return Math.round((num + Number.EPSILON) * factor) / factor
}

/**
 * Rule 270: Safe Local Storage / Session Storage quota handling.
 */
export function safeStorageSetItem(storage: Storage, key: string, value: string): boolean {
  if (!storage || typeof storage.setItem !== "function") return false
  try {
    storage.setItem(key, value)
    return true
  } catch (error) {
    // Catch DOMException QUOTA_EXCEEDED_ERR
    if (
      error instanceof DOMException &&
      (error.code === 22 ||
        error.code === 1014 ||
        error.name === "QuotaExceededError" ||
        error.name === "NS_ERROR_DOM_QUOTA_REACHED")
    ) {
      try {
        // Evict expired or non-essential cache items if available
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i)
          if (k && (k.includes("cache") || k.includes("temp") || k.includes("draft"))) {
            storage.removeItem(k)
          }
        }
        storage.setItem(key, value)
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

/**
 * Rule 274: Safe ReDoS regular expression execution guard with length limit.
 */
export function safeReDoSCheck(str: string, pattern: RegExp, maxLength = 10000): boolean {
  if (typeof str !== "string" || str.length > maxLength) return false
  try {
    return pattern.test(str)
  } catch {
    return false
  }
}

/**
 * Rule 280: Speech Recognition / Web Speech API capability helper.
 */
export function safeSpeechCapabilities(): { recognition: boolean; synthesis: boolean } {
  if (typeof window === "undefined") return { recognition: false, synthesis: false }
  const hasRecognition = "SpeechRecognition" in window || "webkitSpeechRecognition" in window
  const hasSynthesis = "speechSynthesis" in window && typeof window.speechSynthesis.speak === "function"
  return { recognition: hasRecognition, synthesis: hasSynthesis }
}

/**
 * Rule 264: Validates ARIA boolean values to avoid undefined or object artifacts.
 */
export function safeAriaBoolean(val: unknown): "true" | "false" | undefined {
  if (val === true || val === "true") return "true"
  if (val === false || val === "false") return "false"
  return undefined
}

/**
 * Rule 276: WebGL / Canvas context loss recovery listener helper.
 */
export function safeWebGLContextRestorer(
  canvas: HTMLCanvasElement,
  onRestore?: () => void
): () => void {
  if (!canvas || typeof canvas.addEventListener !== "function") {
    return () => {}
  }
  const handleLost = (e: Event) => {
    e.preventDefault()
  }
  const handleRestored = () => {
    onRestore?.()
  }
  canvas.addEventListener("webglcontextlost", handleLost, false)
  canvas.addEventListener("webglcontextrestored", handleRestored, false)
  return () => {
    canvas.removeEventListener("webglcontextlost", handleLost)
    canvas.removeEventListener("webglcontextrestored", handleRestored)
  }
}

/**
 * Rule 265: ResizeObserver wrapper with requestAnimationFrame safety.
 */
export function createResizeObserverSafe(callback: ResizeObserverCallback): ResizeObserver | undefined {
  if (typeof ResizeObserver === "undefined") return undefined
  return new ResizeObserver((entries, observer) => {
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => {
        try {
          callback(entries, observer)
        } catch {
          // Prevent ResizeObserver callback errors from crashing layout
        }
      })
    } else {
      try {
        callback(entries, observer)
      } catch {}
    }
  })
}
