function copyWithTemporaryTextarea(text) {
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export async function writeTextToClipboard(text) {
  if (!text) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Restricted browser shells can deny the modern API while allowing
      // the user-initiated legacy copy command.
    }
  }

  return copyWithTemporaryTextarea(text);
}

// Triggers a client-side Markdown download without touching the canonical
// project record — the file is built from the in-memory capsule facts, so the
// generated resume is derived output, never written back to source.
export function downloadTextFile(filename: string, text: string): boolean {
  if (
    !text ||
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    !URL.createObjectURL
  ) {
    return false;
  }

  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return true;
}
