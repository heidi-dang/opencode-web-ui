import { describe, it, expect } from "bun:test";
import { SseParser } from "../utils/sse-parser";

describe("SseParser", () => {
  it("parses a single LF-delimited event", () => {
    const p = new SseParser();
    const frames: any[] = [];
    p.feed("event: run.progress\ndata: {\"type\":\"run.progress\"}\n\n", (f) => frames.push(f));
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("run.progress");
    expect(frames[0].data).toEqual(['{"type":"run.progress"}']);
  });

  it("parses a single CRLF-delimited event", () => {
    const p = new SseParser();
    const frames: any[] = [];
    p.feed("event: run.progress\r\ndata: {}\r\n\r\n", (f) => frames.push(f));
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("run.progress");
  });

  it("handles CRLF split across two chunks", () => {
    const p = new SseParser();
    const frames: any[] = [];
    p.feed("event: run.progress\r\ndata: {}\r", (f) => frames.push(f));
    p.feed("\n\n", (f) => frames.push(f));
    expect(frames).toHaveLength(1);
  });

  it("handles lone CR line terminator", () => {
    const p = new SseParser();
    const frames: any[] = [];
    p.feed("event: run.progress\rdata: {}\r\r", (f) => frames.push(f));
    expect(frames).toHaveLength(1);
  });

  it("parses multiple frames in one chunk", () => {
    const p = new SseParser();
    const frames: any[] = [];
    p.feed(
      "event: run.progress\ndata: {\"p\":1}\n\n" +
      "event: run.progress\ndata: {\"p\":2}\n\n",
      (f) => frames.push(f)
    );
    expect(frames).toHaveLength(2);
  });

  it("extracts event id field", () => {
    const p = new SseParser();
    const frames: any[] = [];
    p.feed("id: 42\nevent: run.progress\ndata: {}\n\n", (f) => frames.push(f));
    expect(frames[0].id).toBe("42");
  });

  it("ignores comment lines", () => {
    const p = new SseParser();
    const frames: any[] = [];
    p.feed(": this is a comment\nevent: run.progress\ndata: {}\n\n", (f) => frames.push(f));
    expect(frames).toHaveLength(1);
  });

  it("joins multi-line data with newline", () => {
    const p = new SseParser();
    const frames: any[] = [];
    p.feed("event: run.progress\ndata: line1\ndata: line2\n\n", (f) => frames.push(f));
    expect(frames).toHaveLength(1);
    expect(frames[0].data.join("\n")).toBe("line1\nline2");
  });

  it("does not emit for incomplete trailing frame", () => {
    const p = new SseParser();
    const frames: any[] = [];
    p.feed("event: run.progress\ndata: incomplete", (f) => frames.push(f));
    expect(frames).toHaveLength(0);
  });

  it("handles UTF-8 split across byte chunks", () => {
    const p = new SseParser();
    const frames: any[] = [];
    p.feed("event: run.progress\ndata: \u00e9", (f) => frames.push(f));
    p.feed("\u00e0\n\n", (f) => frames.push(f));
    expect(frames).toHaveLength(1);
    expect(frames[0].data[0]).toBe("\u00e9\u00e0");
  });

  it("resets parser state", () => {
    const p = new SseParser();
    p.feed("event: run.progress\ndata: {}\n\n", () => {});
    p.reset();
    const frames: any[] = [];
    p.feed("event: run.progress\ndata: {}\n\n", (f) => frames.push(f));
    expect(frames).toHaveLength(1);
  });

  it("heartbeat does not advance id", () => {
    const p = new SseParser();
    const frames: any[] = [];
    p.feed("event: heartbeat\ndata: {\"time\":\"...\"}\n\n", (f) => frames.push(f));
    expect(frames[0].event).toBe("heartbeat");
    expect(frames[0].id).toBeUndefined();
  });
});
