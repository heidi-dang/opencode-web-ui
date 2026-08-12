import { type JSX } from "solid-js"

export const SettingsList = (props: { children: JSX.Element }) => {
  return <div class="bg-surface-base px-4 rounded-lg">{props.children}</div>
}
