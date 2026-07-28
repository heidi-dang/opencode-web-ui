/**
 * Better Harness main page component.
 * Integrates with OpenCode Web UI's server context, authentication,
 * and design system.
 */
import { createEffect, createSignal, onCleanup, Switch, Match, Show } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";

// Simple English-only i18n helper for BH keys. The keys exist in all 17 locale
// files; wiring to the app's useLanguage() is a follow-up task.
function t(key: string): string {
  const dict: Record<string, string> = {
    "better-harness.loading": "Loading Better Harness...",
    "better-harness.regenerate": "Regenerate",
    "better-harness.cancel": "Cancel",
    "better-harness.findings": "Findings",
    "better-harness.history": "History",
    "better-harness.empty": "No report yet. Run an analysis to get started.",
    "better-harness.score.overall": "Overall Score",
    "better-harness.title": "Better Harness",
    "better-harness.progress.running": "Running analysis...",
  };
  return dict[key] || key;
}
import { createBetterHarnessStore } from "../stores/better-harness";
import { BetterHarnessUnavailable } from "../components/BetterHarnessUnavailable";

export function BetterHarnessPage() {
  const params = useParams<{ serverKey: string; projectKey: string }>();
  const navigate = useNavigate();
  const [initialised, setInitialised] = createSignal(false);

  // Get server and project context from route params
  const serverKey = () => params.serverKey;
  const projectKey = () => params.projectKey;

  // Derive transport URL from the current page's origin
  const baseUrl = () => window.location.origin;

  // Create the store with runtime-discovered config
  const store = createBetterHarnessStore({
    baseUrl: baseUrl(),
    serverKey: serverKey(),
    projectKey: projectKey(),
  });

  createEffect(async () => {
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
          <Match when={!store.state.available}>
            <BetterHarnessUnavailable reason={store.state.availableReason} />
          </Match>

          <Match when={store.state.available}>
            <div class="space-y-6 p-4 sm:p-6">
              {/* Header */}
              <div class="flex items-center justify-between">
                <h1 class="text-xl font-bold">{t("better-harness.title")}</h1>
                <Show when={!store.state.running}>
                  <button
                    onClick={() => store.regenerate()}
                    class="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                    disabled={store.state.loading}
                  >
                    {t("better-harness.regenerate")}
                  </button>
                </Show>
                <Show when={store.state.running}>
                  <button
                    onClick={() => store.cancelRun()}
                    class="px-4 py-2 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {t("better-harness.cancel")}
                  </button>
                </Show>
              </div>

              {/* Loading state */}
              <Show when={store.state.loading && !store.state.report}>
                <div class="p-8 text-center text-sm">{t("better-harness.loading")}</div>
              </Show>

              {/* Error state */}
              <Show when={store.state.error}>
                <div class="p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
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
                  <div class="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      class="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${store.state.runProgress?.progressPercent ?? 0}%` }}
                    />
                  </div>
                </div>
              </Show>

              {/* Report */}
              <Show when={store.state.report}>
                <div class="space-y-6">
                  {/* Overall Score */}
                  <div class="p-6 rounded-xl border bg-card text-card-foreground">
                    <div class="text-3xl font-bold">{store.state.report?.overallScore}</div>
                    <div class="text-sm text-muted-foreground">{t("better-harness.score.overall")}</div>
                  </div>

                  {/* Dimensions */}
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {store.state.report?.dimensions.map((dim) => (
                      <div class="p-4 rounded-lg border bg-card text-card-foreground">
                        <div class="font-medium text-sm">{dim.dimension}</div>
                        <div class="text-2xl font-bold mt-1">{dim.score}</div>
                        <div class="text-xs text-muted-foreground mt-1">
                          {dim.findingCount} {t("better-harness.findings")}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Findings */}
                  <div class="space-y-2">
                    <h2 class="font-semibold">{t("better-harness.findings")}</h2>
                    {store.state.report?.findings.map((finding) => (
                      <div class="p-4 rounded-lg border bg-card text-card-foreground">
                        <div class="flex items-start justify-between gap-2">
                          <div>
                            <div class="font-medium text-sm">{finding.title}</div>
                            <div class="text-xs text-muted-foreground mt-1">{finding.cause}</div>
                          </div>
                          <span class={`px-2 py-0.5 rounded text-xs font-medium ${
                            finding.priority === "high" || finding.priority === "critical"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-muted-foreground"
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
                        <div class="p-3 rounded-lg border bg-card text-card-foreground text-sm">
                          <div class="flex justify-between">
                            <span class="font-medium">{t("better-harness.score.overall")}: {entry.overallScore}</span>
                            <span class="text-xs text-muted-foreground">{new Date(entry.generatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Show>
                </div>
              </Show>

              {/* Empty state */}
              <Show when={!store.state.loading && !store.state.report && !store.state.running && store.state.available}>
                <div class="p-8 text-center text-sm text-muted-foreground">
                  {t("better-harness.empty")}
                  <button
                    onClick={() => store.regenerate()}
                    class="block mx-auto mt-4 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {t("better-harness.regenerate")}
                  </button>
                </div>
              </Show>
            </div>
          </Match>
        </Switch>
      </Show>
    </div>
  );
}
