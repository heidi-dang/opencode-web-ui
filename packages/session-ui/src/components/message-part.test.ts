import { describe, expect, test } from "bun:test"
import { isLastTextPart, readPartText } from "./message-part-text"

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})

describe("isLastTextPart", () => {
  const parts = (items: { id: string; type: string; text?: string }[]) => items

  test("returns false when parts are undefined", () => {
    expect(isLastTextPart(undefined, "part_1")).toBe(false)
  })

  test("returns false for an empty list", () => {
    expect(isLastTextPart([], "part_1")).toBe(false)
  })

  test("returns false when the id is not in the list", () => {
    expect(isLastTextPart(parts([{ id: "part_1", type: "text", text: "a" }]), "part_missing")).toBe(false)
  })

  test("returns true for a single text part", () => {
    expect(isLastTextPart(parts([{ id: "part_1", type: "text", text: "a" }]), "part_1")).toBe(true)
  })

  test("returns true when the part is the tail text part with non-text parts after it", () => {
    expect(
      isLastTextPart(
        parts([
          { id: "part_1", type: "text", text: "a" },
          { id: "call_1", type: "tool" },
        ]),
        "part_1",
      ),
    ).toBe(true)
  })

  test("returns false for an earlier text part when a later text part exists", () => {
    expect(
      isLastTextPart(
        parts([
          { id: "part_1", type: "text", text: "a" },
          { id: "part_2", type: "text", text: "b" },
        ]),
        "part_1",
      ),
    ).toBe(false)
  })

  test("returns true for the final text part among several", () => {
    expect(
      isLastTextPart(
        parts([
          { id: "part_1", type: "text", text: "a" },
          { id: "part_2", type: "text", text: "b" },
        ]),
        "part_2",
      ),
    ).toBe(true)
  })

  test("ignores whitespace-only and empty text parts", () => {
    expect(
      isLastTextPart(
        parts([
          { id: "part_1", type: "text", text: "a" },
          { id: "part_blank", type: "text", text: "   \n  " },
          { id: "call_1", type: "tool" },
        ]),
        "part_1",
      ),
    ).toBe(true)
    expect(
      isLastTextPart(
        parts([
          { id: "part_blank", type: "text", text: "   \n  " },
          { id: "call_1", type: "tool" },
        ]),
        "part_blank",
      ),
    ).toBe(false)
  })
})
