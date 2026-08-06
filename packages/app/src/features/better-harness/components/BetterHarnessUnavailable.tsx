import { ErrorStateV2 } from "@opencode-ai/ui/v2/empty-state-v2";

interface Props {
  reason?: string;
}

export function BetterHarnessUnavailable(props: Props) {
  const getReason = () => {
    if (props.reason === "No FlowDeck") return "FlowDeck not installed.";
    if (props.reason === "Not enabled") return "Not enabled for this project.";
    if (props.reason === "No project selected") return "Please open a project to use Better Harness.";
    return props.reason || "Not available on this server.";
  };

  return (
    <div class="p-8 flex justify-center items-center min-h-[300px]">
      <ErrorStateV2
        title="Better Harness Unavailable"
        description={getReason()}
      />
    </div>
  );
}
