/**
 * Better Harness main page component.
 * Integrates with OpenCode Web UI's server context, authentication,
 * and design system.
 */
import { createEffect, createSignal, onCleanup, Switch, Match, Show } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { useGlobal } from "@/context/global";
import { ServerConnection } from "@/context/server";

import { useLanguage } from "@/context/language";
import { createBetterHarnessStore } from "../stores/better-harness";
import { BetterHarnessUnavailable } from "../components/BetterHarnessUnavailable";
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2";

import { useServer } from "@/context/server";

export function BetterHarnessPage() {
  const language = useLanguage();
  const t = (key: string, params?: Record<string, string | number | boolean>) => language.t(key, params);
  const params = useParams<{ serverKey: string; projectKey: string }>();
  const navigate = useNavigate();
  const [initialised, setInitialised] = createSignal(false);
  const server = useServer();

  // Get server and project context from route params or defaults
  const serverKey = () => params.serverKey || server.key;
  const projectKey = () => params.projectKey || "";

  // Derive transport URL from the current page's origin
  const baseUrl = () => window.location.origin;

  // Create the store with runtime-discovered config
  const global = useGlobal();
  const serverConn = () => global.servers.list().find((s: any) => ServerConnection.key(s) === serverKey());
  
  const store = createBetterHarnessStore({
    baseUrl: baseUrl(),
    serverKey: serverKey(),
    projectKey: projectKey(),
    authToken: serverConn()?.type === "http" ? serverConn()?.http?.password : undefined,
  });

  createEffect(async () => {
    if (!projectKey()) {
      setInitialised(true);
      return;
    }
    const available = await store.checkAvailability();
    setInitialised(true);
    if (available) {
      await store.loadReport();
    }
  });

  onCleanup(() => {
    // Store cleanup is handled by onCleanup in the store creator
  });

  return (
    <div class="better-harness-page">
      <Show when={!initialised()}>
        <div class="p-8 text-center text-sm">{t("better-harness.loading")}</div>
      </Show>

      <Show when={initialised()}>
        <Switch>
          <Match when={!projectKey()}>
            <BetterHarnessUnavailable reason="No project selected" />
          </Match>
          <Match when={!store.state.available}>
            <BetterHarnessUnavailable reason={store.state.availableReason} />
          </Match>

          <Match when={store.state.available}>
            <div class="space-y-6 p-4 sm:p-6">
              {/* Header */}
              <div class="flex items-center justify-between">
                <h1 class="text-xl font-bold">{t("better-harness.title")}</h1>
                <Show when={!store.state.running}>
                  <ButtonV2
                    variant="contrast"
                    onClick={() => store.regenerate()}
                    disabled={store.state.loading}
                  >
                    {t("better-harness.regenerate")}
                  </ButtonV2>
                </Show>
                <Show when={store.state.running}>
                  <ButtonV2
                    variant="danger"
                    onClick={() => store.cancelRun()}
                  >
                    {t("better-harness.cancel")}
                  </ButtonV2>
                </Show>
              </div>

              {/* Loading state */}
              <Show when={store.state.loading && !store.state.report}>
                <div class="p-8 text-center text-sm">{t("better-harness.loading")}</div>
              </Show>

              {/* Error state */}
              <Show when={store.state.error}>
                <div class="p-4 rounded-lg bg-surface-danger-base/10 text-text-danger text-sm">
                  {store.state.error}
                </div>
              </Show>

              {/* Run Progress */}
              <Show when={store.state.running && store.state.runProgress}>
                <div class="space-y-2">
                  <div class="flex justify-between text-sm">
                    <span>{store.state.runProgress?.stage || t("better-harness.progress.running")}</span>
                    <span>{store.state.runProgress?.progressPercent ?? 0}%</span>
                  </div>
                  <div class="h-2 rounded-full bg-surface-raised-base overflow-hidden">
                    <div
                      class="h-full rounded-full bg-surface-accent-base transition-all duration-500"
                      style={{ width: `${store.state.runProgress?.progressPercent ?? 0}%` }}
                    />
                  </div>
                </div>
              </Show>

              {/* Report */}
              <Show when={store.state.report}>
                <div class="space-y-6">
                  {/* Overall Score */}
                  <div class="p-6 rounded-xl border border-border-weak-base bg-surface-panel text-text-base">
                    <div class="text-3xl font-bold">{store.state.report?.overallScore}</div>
                    <div class="text-sm text-text-weak">{t("better-harness.score.overall")}</div>
                  </div>

                  {/* Dimensions */}
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {store.state.report?.dimensions.map((dim) => (
                      <div class="p-4 rounded-lg border border-border-weak-base bg-surface-panel text-text-base">
                        <div class="font-medium text-sm">{dim.dimension}</div>
                        <div class="text-2xl font-bold mt-1">{dim.score}</div>
                        <div class="text-xs text-text-weak mt-1">
                          {dim.findingCount} {t("better-harness.findings")}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Findings */}
                  <div class="space-y-2">
                    <h2 class="font-semibold">{t("better-harness.findings")}</h2>
                    {store.state.report?.findings.map((finding) => (
                      <div class="p-4 rounded-lg border border-border-weak-base bg-surface-panel text-text-base">
                        <div class="flex items-start justify-between gap-2">
                          <div>
                            <div class="font-medium text-sm">{finding.title}</div>
                            <div class="text-xs text-text-weak mt-1">{finding.cause}</div>
                          </div>
                          <span class={`px-2 py-0.5 rounded text-xs font-medium ${
                            finding.priority === "high" || finding.priority === "critical"
                              ? "bg-surface-danger-base/10 text-text-danger"
                              : "bg-surface-raised-base text-text-weak"
                          }`}>
                            {finding.priority}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* History */}
                  <Show when={store.state.history.length > 0}>
                    <div class="space-y-2">
                      <h2 class="font-semibold">{t("better-harness.history")}</h2>
                      {store.state.history.slice(0, 5).map((entry) => (
                        <div class="p-3 rounded-lg border border-border-weak-base bg-surface-panel text-text-base text-sm">
                          <div class="flex justify-between">
                            <span class="font-medium">{t("better-harness.score.overall")}: {entry.overallScore}</span>
                            <span class="text-xs text-text-weak">{new Date(entry.generatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Show>
                </div>
              </Show>

              {/* Empty state */}
              <Show when={!store.state.loading && !store.state.report && !store.state.running && store.state.available}>
                <div class="p-8 text-center text-sm text-text-weak flex flex-col items-center">
                  {t("better-harness.empty")}
                  <ButtonV2
                    variant="contrast"
                    onClick={() => store.regenerate()}
                    class="mt-4"
                  >
                    {t("better-harness.regenerate")}
                  </ButtonV2>
                </div>
              </Show>
            </div>
          </Match>
        </Switch>
      </Show>
    </div>
  );
}
