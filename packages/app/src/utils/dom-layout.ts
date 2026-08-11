/**
 * DOM Tree Stability, CSS Engine & Layout Preservation Utilities (Fixes 381-390)
 */

/**
 * 381. Scroll Position Restoration
 * Saves the scroll offset of an element before mutations and restores it afterward to avoid jumpy page shifts.
 */
export class ScrollRestorer {
  private element: HTMLElement;
  private savedScrollTop = 0;
  private savedScrollLeft = 0;

  constructor(element: HTMLElement) {
    this.element = element;
  }

  public save(): void {
    this.savedScrollTop = this.element.scrollTop;
    this.savedScrollLeft = this.element.scrollLeft;
  }

  public restore(): void {
    this.element.scrollTop = this.savedScrollTop;
    this.element.scrollLeft = this.savedScrollLeft;
  }
}

/**
 * 382. Textarea Auto-Resize Reflow Elimination
 * Adjusts textarea height off-screen using a ghost copy to eliminate layout shifts during auto-sizing.
 */
export function adjustTextareaHeightWithoutReflow(textarea: HTMLTextAreaElement): void {
  const ghost = document.createElement("textarea");
  ghost.style.position = "absolute";
  ghost.style.visibility = "hidden";
  ghost.style.width = `${textarea.clientWidth}px`;
  ghost.style.height = "auto";
  ghost.value = textarea.value;
  document.body.appendChild(ghost);

  // Set height based on scrollHeight of off-screen ghost
  const targetHeight = ghost.scrollHeight;
  document.body.removeChild(ghost);

  textarea.style.height = `${targetHeight}px`;
}

/**
 * 385. Sub-Pixel Rendering Alignment
 * Snaps absolute layout element coordinates to integer pixels to prevent text blurriness.
 */
export function snapToIntegerPixels(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const top = Math.round(rect.top);
  const left = Math.round(rect.left);
  element.style.top = `${top}px`;
  element.style.left = `${left}px`;
}

/**
 * 387. High-DPI Screen Canvas Rescale
 * Rescales canvas drawing buffers based on devicePixelRatio to maintain visual crispness.
 */
export function scaleCanvasForHighDPI(canvas: HTMLCanvasElement, width: number, height: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.scale(dpr, dpr);
}

/**
 * 389. Drag-and-Drop Ghost Element Cleanup
 * Cleans up temporary custom drag ghost elements on drag end.
 */
export class DragGhostCleanupManager {
  private ghostElements = new Set<HTMLElement>();

  public registerGhost(el: HTMLElement): void {
    this.ghostElements.add(el);
  }

  public cleanup(): void {
    this.ghostElements.forEach((el) => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });
    this.ghostElements.clear();
  }
}
