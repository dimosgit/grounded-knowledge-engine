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
