function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function renderHighlighted(text, query) {
  const needle = query.trim();
  if (!needle) return text;

  const pattern = new RegExp(`(${escapeRegExp(needle)})`, "ig");
  const chunks = text.split(pattern);
  const lowerNeedle = needle.toLowerCase();

  return chunks.map((chunk, index) =>
    chunk.toLowerCase() === lowerNeedle ? <mark key={`${chunk}-${index}`}>{chunk}</mark> : chunk,
  );
}
