export function sessionPanelLayout(input: { review: boolean; terminal: boolean; files: boolean; preview?: boolean }) {
  const hasSidePanel = input.review || input.files;
  const visibleCount = [hasSidePanel, input.terminal, input.preview].filter(Boolean).length;
  return {
    visible: hasSidePanel || input.terminal || !!input.preview,
    stacked: visibleCount >= 2,
  }
}
