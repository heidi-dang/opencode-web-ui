import { Match, Switch } from "solid-js";
import { useI18n } from "../../../i18n";

interface Props {
  reason?: string;
}

export function BetterHarnessUnavailable(props: Props) {
  const { t } = useI18n();
  return (
    <div class="p-8 text-center">
      <div class="max-w-md mx-auto space-y-4">
        <div class="text-4xl">🔌</div>
        <h2 class="text-lg font-semibold">
          {t("better-harness.unavailable.title")}
        </h2>
        <p class="text-sm text-balance">
          <Switch fallback={props.reason || t("better-harness.unavailable.description")}>
            <Match when={props.reason === "No FlowDeck"}>
              {t("better-harness.unavailable.no-flowdeck")}
            </Match>
            <Match when={props.reason === "Not enabled"}>
              {t("better-harness.unavailable.not-enabled")}
            </Match>
          </Switch>
        </p>
      </div>
    </div>
  );
}
