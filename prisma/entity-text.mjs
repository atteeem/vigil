// Plain-JS mirror of normalizeEntityText in lib/military/aliases.ts (the seed runs under bare
// node). tests/military-knowledge.spec.ts asserts the two agree.
export function normalizeEntityText(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}'\s.-]+/gu, " ")
    .replace(/^\s*the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}
