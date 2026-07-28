import { Match, Switch } from "solid-js";

interface Props {
  reason?: string;
}

export function BetterHarnessUnavailable(props: Props) {
  return (
    <div class="p-8 text-center">
      <div class="max-w-md mx-auto space-y-4">
        <div class="text-4xl">🔌</div>
        <h2 class="text-lg font-semibold">Better Harness Unavailable</h2>
        <p class="text-sm text-balance">
          <Switch fallback={props.reason || "Not available on this server."}>
            <Match when={props.reason === "No FlowDeck"}>
              FlowDeck not installed.
            </Match>
            <Match when={props.reason === "Not enabled"}>
              Not enabled for this project.
            </Match>
          </Switch>
        </p>
      </div>
    </div>
  );
}
