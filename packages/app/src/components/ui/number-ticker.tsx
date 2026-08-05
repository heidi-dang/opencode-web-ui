import { createSignal, createEffect, onCleanup, type Component, type JSX } from "solid-js"

export const NumberTicker: Component<{
  value: number
  format?: (val: number) => string
  durationMs?: number
  class?: string
  style?: JSX.CSSProperties
}> = (props) => {
  const [displayValue, setDisplayValue] = createSignal(props.value)
  
  createEffect((prevValue: number) => {
    const target = props.value
    const startValue = prevValue ?? target
    if (startValue === target) {
      setDisplayValue(target)
      return target
    }

    const startTime = performance.now()
    const duration = props.durationMs ?? 300
    let animationFrame: number

    const step = (currentTime: number) => {
      const elapsed = currentTime - startTime
      if (elapsed >= duration) {
        setDisplayValue(target)
      } else {
        const progress = Math.min(elapsed / duration, 1)
        // easeOutQuart
        const easeProgress = 1 - Math.pow(1 - progress, 4)
        setDisplayValue(startValue + (target - startValue) * easeProgress)
        animationFrame = requestAnimationFrame(step)
      }
    }

    animationFrame = requestAnimationFrame(step)

    onCleanup(() => {
      cancelAnimationFrame(animationFrame)
    })

    return target
  }, props.value)

  return (
    <span class={props.class} style={props.style}>
      {props.format ? props.format(displayValue()) : Math.round(displayValue())}
    </span>
  )
}
