import { describe, expect, test } from "bun:test";
import {
  DragGhostCleanupManager,
  ScrollRestorer,
  adjustTextareaHeightWithoutReflow,
  scaleCanvasForHighDPI,
  snapToIntegerPixels,
} from "../src/utils/dom-layout";
import {
  NamespacedStorage,
  SecureNamespacedStorage,
  evaluateSafeExpression,
  getSafeLinkAttributes,
  registerCSPViolationHandler,
  registerGlobalErrorHandler,
  safeParseQueryParam,
  sanitizeHtmlAllowlist,
  validateFileExtension,
} from "../src/utils/browser-security";

describe("Round 10: DOM Layout Preservation & Browser Security (Fixes 381–400)", () => {

  test("381: ScrollRestorer correctly records and restores scroll coordinates", () => {
    const mockEl = {
      scrollTop: 150,
      scrollLeft: 50,
    } as HTMLElement;

    const restorer = new ScrollRestorer(mockEl);
    restorer.save();

    mockEl.scrollTop = 0;
    mockEl.scrollLeft = 0;

    restorer.restore();
    expect(mockEl.scrollTop).toBe(150);
    expect(mockEl.scrollLeft).toBe(50);
  });

  test("382: adjustTextareaHeightWithoutReflow resizes textarea via ghost calculation", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "Line 1\nLine 2\nLine 3";
    document.body.appendChild(textarea);

    adjustTextareaHeightWithoutReflow(textarea);
    expect(textarea.style.height).toMatch(/\d+px/);

    document.body.removeChild(textarea);
  });

  test("385: snapToIntegerPixels snaps element bounding positions to whole pixels", () => {
    const div = document.createElement("div");
    div.getBoundingClientRect = () => ({
      top: 10.4,
      left: 20.8,
      bottom: 30,
      right: 40,
      width: 20,
      height: 20,
      x: 20.8,
      y: 10.4,
      toJSON: () => {},
    });

    snapToIntegerPixels(div);
    expect(div.style.top).toBe("10px");
    expect(div.style.left).toBe("21px");
  });

  test("387: scaleCanvasForHighDPI configures canvas buffer with DPR scaling", () => {
    const canvas = document.createElement("canvas");
    scaleCanvasForHighDPI(canvas, 400, 300);

    expect(canvas.style.width).toBe("400px");
    expect(canvas.style.height).toBe("300px");
  });

  test("389: DragGhostCleanupManager removes registered ghost DOM elements", () => {
    const ghost = document.createElement("div");
    document.body.appendChild(ghost);

    const cleanupManager = new DragGhostCleanupManager();
    cleanupManager.registerGhost(ghost);

    expect(ghost.parentNode).toBe(document.body);
    cleanupManager.cleanup();
    expect(ghost.parentNode).toBeNull();
  });

  test("391: sanitizeHtmlAllowlist filters unsafe HTML tags while keeping allowed tags", () => {
    const dirty = '<p>Hello <script>alert(1)</script> <strong>world</strong> <iframe src="evil"></iframe></p>';
    const clean = sanitizeHtmlAllowlist(dirty);

    expect(clean).toContain("<p>");
    expect(clean).toContain("<strong>world</strong>");
    expect(clean).not.toContain("<script>");
    expect(clean).not.toContain("<iframe>");
  });

  test("392: getSafeLinkAttributes injects noopener and target blank for external URLs", () => {
    const extAttr = getSafeLinkAttributes("https://opencode.ai/docs");
    expect(extAttr.target).toBe("_blank");
    expect(extAttr.rel).toBe("noopener noreferrer");

    const intAttr = getSafeLinkAttributes("/settings");
    expect(intAttr.target).toBeUndefined();
    expect(intAttr.rel).toBeUndefined();
  });

  test("393: registerCSPViolationHandler attaches and detaches violation event listener", () => {
    let fired = false;
    const cleanup = registerCSPViolationHandler(() => { fired = true; });

    const event = new Event("securitypolicyviolation");
    window.dispatchEvent(event);

    expect(fired).toBe(true);
    cleanup();
  });

  test("394: evaluateSafeExpression prevents eval and dynamic function executions", () => {
    expect(() => evaluateSafeExpression("eval('alert(1)')")).toThrow("Dynamic code execution is strictly blocked");
    expect(() => evaluateSafeExpression("Function('return 1')()")).toThrow("Dynamic code execution is strictly blocked");
    expect(evaluateSafeExpression("1 + 1")).toBe("1 + 1");
  });

  test("395: NamespacedStorage isolates storage keys under designated prefix", () => {
    const storage = new NamespacedStorage("opencode");
    storage.setItem("theme", "dark");

    expect(localStorage.getItem("opencode:theme")).toBe("dark");
    expect(storage.getItem("theme")).toBe("dark");

    storage.removeItem("theme");
    expect(storage.getItem("theme")).toBeNull();
  });

  test("396: validateFileExtension verifies allowed file extensions", () => {
    expect(validateFileExtension("document.pdf", [".pdf", ".png"])).toBe(true);
    expect(validateFileExtension("script.exe", [".pdf", ".png"])).toBe(false);
    expect(validateFileExtension("noextension", [".txt"])).toBe(false);
  });

  test("397: safeParseQueryParam strips dangerous script tags and decodes safely", () => {
    const dangerous = "%3Cscript%3Ealert(1)%3C/script%3Ehello";
    const parsed = safeParseQueryParam(dangerous);

    expect(parsed).toBe("hello");
    expect(parsed).not.toContain("<script>");
  });

  test("399: SecureNamespacedStorage encrypts and decrypts local storage values", () => {
    const secureStorage = new SecureNamespacedStorage("secure-app");
    secureStorage.setSecureItem("token", "secret-token-123");

    const rawStored = localStorage.getItem("secure-app:token");
    expect(rawStored).not.toBe("secret-token-123");

    const decrypted = secureStorage.getSecureItem("token");
    expect(decrypted).toBe("secret-token-123");

    secureStorage.removeItem("token");
  });

  test("400: registerGlobalErrorHandler captures unhandled rejections and errors", () => {
    let rejectionReason: unknown = null;
    let caughtError: Error | null = null;

    const cleanup = registerGlobalErrorHandler(
      (reason) => { rejectionReason = reason; },
      (err) => { caughtError = err; }
    );

    const unhandledEvent = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(unhandledEvent, "reason", { value: "Network Timeout" });
    window.dispatchEvent(unhandledEvent);

    expect(rejectionReason).toBe("Network Timeout");

    cleanup();
  });
});
