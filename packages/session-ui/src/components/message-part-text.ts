export function readPartText(accum: Record<string, string> | undefined, part: { id: string; text?: string }): string {
  return (accum?.[part.id] ?? part.text ?? "").trim()
}

/**
 * True when `partID` is the last non-empty text part in `parts`.
 *
 * Scans from the tail with an early exit so the common streaming case (the
 * part being rendered is the current tail text part) resolves in O(1) instead
 * of filtering the whole list on every text delta.
 */
export function isLastTextPart(
  parts: readonly { id: string; type: string; text?: string }[] | undefined,
  partID: string,
): boolean {
  if (!parts) return false
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index]
    if (!part || part.type !== "text" || !part.text?.trim()) continue
    return part.id === partID
  }
  return false
}
