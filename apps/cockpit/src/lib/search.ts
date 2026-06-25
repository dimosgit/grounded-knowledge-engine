function normalizeInput(value) {
  return String(value || "").toLowerCase();
}

export function normalizeSearchText(value) {
  return normalizeInput(value)
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSearchFields(value) {
  const raw = normalizeInput(value);
  const normalized = normalizeSearchText(raw);
  const compact = normalized.replace(/\s+/g, "");
  return { raw, normalized, compact };
}

export function matchesSearchFields(fields, query) {
  const rawNeedle = normalizeInput(query).trim();
  if (!rawNeedle) return true;

  const rawHaystack = fields?.raw || "";
  const normalizedHaystack = fields?.normalized || "";
  const compactHaystack = fields?.compact || "";

  if (rawHaystack.includes(rawNeedle)) return true;

  const normalizedNeedle = normalizeSearchText(rawNeedle);
  if (!normalizedNeedle) return false;
  if (normalizedHaystack.includes(normalizedNeedle)) return true;

  const compactNeedle = normalizedNeedle.replace(/\s+/g, "");
  if (compactNeedle && compactHaystack.includes(compactNeedle)) return true;

  const tokens = normalizedNeedle.split(" ").filter((token) => token.length > 1);
  if (!tokens.length) return false;

  return tokens.every(
    (token) => normalizedHaystack.includes(token) || compactHaystack.includes(token),
  );
}
