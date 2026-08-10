import { splitProps, type JSX } from "solid-js"

const RESIZE_STEP = 10

export interface ResizeHandleProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onResize"> {
  direction: "horizontal" | "vertical"
  edge?: "start" | "end"
  size: number
  min: number
  max: number
  onResize: (size: number) => void
  onCollapse?: () => void
  /** Called while dragging when size crosses `collapseThreshold`. */
  onCollapseChange?: (collapsed: boolean) => void
  collapseThreshold?: number
  /** Accessible label for the separator, e.g. "Resize terminal panel". */
  label?: string
}

export function ResizeHandle(props: ResizeHandleProps) {
  const [local, rest] = splitProps(props, [
    "direction",
    "edge",
    "size",
    "min",
    "max",
    "onResize",
    "onCollapse",
    "onCollapseChange",
    "collapseThreshold",
    "label",
    "class",
    "classList",
  ])

  const handleMouseDown = (e: MouseEvent) => {
    if (e.detail > 1) return
    e.preventDefault()
    const edge = local.edge ?? (local.direction === "vertical" ? "start" : "end")
    const start = local.direction === "horizontal" ? e.clientX : e.clientY
    const startSize = local.size
    const min = local.min
    const max = local.max
    const threshold = local.collapseThreshold ?? 0
    const onResize = local.onResize
    const onCollapse = local.onCollapse
    const onCollapseChange = local.onCollapseChange
    let current = startSize
    let collapsed = false

    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"

    const onMouseMove = (moveEvent: MouseEvent) => {
      const pos = local.direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY
      const delta =
        local.direction === "vertical"
          ? edge === "end"
            ? pos - start
            : start - pos
          : edge === "start"
            ? start - pos
            : pos - start
      current = startSize + delta
      const nextCollapsed = threshold > 0 && current < threshold
      if (nextCollapsed !== collapsed) {
        collapsed = nextCollapsed
        onCollapseChange?.(collapsed)
      }
      onResize(Math.min(max, Math.max(min, current)))
    }

    const onMouseUp = () => {
      document.body.style.userSelect = ""
      document.body.style.overflow = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)

      if (collapsed) {
        onCollapse?.()
        return
      }
      onCollapseChange?.(false)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    const edge = local.edge ?? (local.direction === "vertical" ? "start" : "end")
    const min = local.min
    const max = local.max
    const threshold = local.collapseThreshold ?? 0
    const current = Math.min(max, Math.max(min, local.size))
    const apply = (next: number) => {
      const clamped = Math.min(max, Math.max(min, next))
      const collapsed = threshold > 0 && clamped < threshold
      local.onCollapseChange?.(collapsed)
      local.onResize(clamped)
      if (collapsed) local.onCollapse?.()
    }
    // Arrow direction maps to the natural "grow" direction of the edge:
    // a right/bottom edge grows toward the pointer direction, a left/top edge
    // grows opposite to it. ArrowUp/ArrowRight always grow.
    const grows =
      local.direction === "vertical" ? edge !== "end" : edge === "start" ? false : true
    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        e.preventDefault()
        apply(current + (grows ? RESIZE_STEP : -RESIZE_STEP))
        break
      case "ArrowDown":
      case "ArrowLeft":
        e.preventDefault()
        apply(current - (grows ? RESIZE_STEP : -RESIZE_STEP))
        break
      case "Home":
        e.preventDefault()
        apply(min)
        break
      case "End":
        e.preventDefault()
        apply(max)
        break
      case "Delete":
      case "Backspace":
        if (!local.onCollapse || threshold <= 0) break
        e.preventDefault()
        local.onCollapse()
        break
    }
  }

  const edge = local.edge ?? (local.direction === "vertical" ? "start" : "end")

  return (
    <div
      {...rest}
      data-component="resize-handle"
      data-direction={local.direction}
      data-edge={edge}
      role="separator"
      tabIndex={0}
      aria-orientation={local.direction === "vertical" ? "horizontal" : "vertical"}
      aria-label={local.label}
      aria-valuenow={Math.round(local.size)}
      aria-valuemin={local.min}
      aria-valuemax={local.max}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
    />
  )
}
