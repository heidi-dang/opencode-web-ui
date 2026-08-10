export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. Try modern clipboard API if available
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return true;
    } catch (e) {
      // Reject could happen due to permission blocks; fall through to execCommand
    }
  }

  // 2. Fallback to execCommand
  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      // Avoid scrolling to bottom or visual disruption
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.width = "2em";
      textarea.style.height = "2em";
      textarea.style.padding = "0";
      textarea.style.border = "none";
      textarea.style.outline = "none";
      textarea.style.boxShadow = "none";
      textarea.style.background = "transparent";

      const body = document.body || document.documentElement;
      body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      
      const successful = document.execCommand("copy");
      body.removeChild(textarea);
      return successful;
    } catch (err) {
      return false;
    }
  }

  return false;
}
