// Title and summary for a report, derived from the source's OWN words. Deterministic and dependency-free: it
// selects and cleans; it never adds a fact, a number, a place or a motive. A generative summariser may be plugged in
// (setSummaryProvider) and is used only when configured and only if it succeeds; publishing never depends on it.

export interface TitleResult {
  title: string;
  source: "source_title" | "text_excerpt" | "none";
}
export interface SummaryResult {
  summary: string;
  source: "source_excerpt" | "title_only" | "ai";
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

/** Plain text of a feed excerpt: tags removed, entities decoded, whitespace collapsed. */
export function cleanText(input: string | null | undefined): string {
  return (input ?? "")
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/\s+/g, " ")
    .replace(/\s*(Read more|Continue reading|The post .* appeared first on .*)\.?\s*$/i, "")
    .trim();
}

function safeChar(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

const TITLE_MIN = 8;
const TITLE_MAX = 220;

/** The source's own headline whenever it is usable (never rewritten); otherwise the first sentence of the text. */
export function deriveTitle(originalTitle: string | null | undefined, originalText: string | null | undefined): TitleResult {
  const own = cleanText(originalTitle);
  if (own.length >= TITLE_MIN && !/^(untitled|no title)/i.test(own)) return { title: own.length > TITLE_MAX ? `${own.slice(0, TITLE_MAX - 1).trimEnd()}…` : own, source: "source_title" };
  const first = firstSentences(cleanText(originalText), 1, 140);
  if (first.length >= TITLE_MIN) return { title: first, source: "text_excerpt" };
  return { title: own || "Untitled report", source: "none" };
}

/** The first `count` sentences, at most `max` characters, cut on a sentence or word boundary (never mid-word). */
export function firstSentences(text: string, count: number, max: number): string {
  if (!text) return "";
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  let out = sentences.slice(0, count).join(" ");
  if (out.length <= max) return out;
  out = out.slice(0, max);
  const cut = Math.max(out.lastIndexOf(". "), out.lastIndexOf(" "));
  return `${out.slice(0, cut > max * 0.5 ? cut : max).trimEnd().replace(/[,;:]$/, "")}…`;
}

export type SummaryProvider = (input: { title: string; text: string }) => Promise<string | null>;
let provider: SummaryProvider | null = null;
/** Registers an optional generative summariser. Absent by default: no AI provider is configured in this project. */
export function setSummaryProvider(p: SummaryProvider | null) {
  provider = p;
}

const SUMMARY_MAX = 480;

/** Concise neutral summary: the opening sentences of the source's own text (not the headline repeated); the
 * headline alone when there is no other text. */
export async function deriveSummary(title: string, originalText: string | null | undefined): Promise<SummaryResult> {
  const text = cleanText(originalText);
  if (provider && text) {
    try {
      const ai = (await provider({ title, text }))?.trim();
      if (ai) return { summary: ai, source: "ai" };
    } catch {
      /* fall through to the deterministic excerpt: publishing never depends on the provider */
    }
  }
  const sameAsTitle = text.toLowerCase().startsWith(title.toLowerCase().replace(/…$/, "")) && text.length < title.length + 40;
  if (!text || sameAsTitle) return { summary: title, source: "title_only" };
  return { summary: firstSentences(text, 2, SUMMARY_MAX), source: "source_excerpt" };
}
