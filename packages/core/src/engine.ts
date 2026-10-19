import { romanizeKana } from "./kana.js";
import {
  YomichiError,
  type Analysis,
  type AnalyzeOptions,
  type Candidate,
  type DictionaryRepository,
  type Lexeme,
  type Token,
} from "./types.js";
export const ENGINE_VERSION = "0.1.0-alpha.1";
export function validateOptions(o: AnalyzeOptions): void {
  if (
    !o ||
    typeof o.text !== "string" ||
    !o.text.trim() ||
    Array.from(o.text).length > 500
  )
    throw new YomichiError(
      "INVALID_TEXT",
      "Text must contain 1–500 Unicode characters.",
    );
  if (
    o.limit !== undefined &&
    (!Number.isInteger(o.limit) || o.limit < 1 || o.limit > 5)
  )
    throw new YomichiError("INVALID_LIMIT", "limit must be 1–5.");
  if (
    o.romanization !== undefined &&
    !["hepburn", "kunrei"].includes(o.romanization)
  )
    throw new YomichiError("INVALID_ROMANIZATION", "Unsupported romanization.");
  const boundaries = new Set([0]);
  let n = 0;
  for (const c of o.text) {
    n += c.length;
    boundaries.add(n);
  }
  if (
    o.segmentationHints !== undefined &&
    (!Array.isArray(o.segmentationHints) ||
      o.segmentationHints.some(
        (p) => !Number.isInteger(p) || !boundaries.has(p),
      ))
  )
    throw new YomichiError(
      "INVALID_HINTS",
      "Hints must be UTF-16 boundaries between Unicode characters.",
    );
}
export async function analyze(
  repo: DictionaryRepository,
  o: AnalyzeOptions,
): Promise<Analysis> {
  validateOptions(o);
  const metadata = await repo.metadata();
  if (!metadata || !metadata.entryCount)
    throw new YomichiError(
      "DICTIONARY_NOT_READY",
      "Import a JMdict dictionary before analysis.",
      503,
    );
  const chars = Array.from(o.text),
    offsets = [0];
  for (const c of chars) offsets.push(offsets.at(-1)! + c.length);
  const hints = new Set(o.segmentationHints ?? []),
    requested = new Set<string>();
  const segments: { end: number; text: string }[][] = chars.map(() => []);
  for (let i = 0; i < chars.length; i++) {
    if (/[\s\p{P}\p{S}]/u.test(chars[i])) continue;
    let value = "";
    for (let j = i; j < Math.min(chars.length, i + 50); j++) {
      if (j > i && (hints.has(offsets[j]) || /[\s\p{P}\p{S}]/u.test(chars[j])))
        break;
      value += chars[j];
      requested.add(value);
      segments[i].push({ end: j + 1, text: value });
    }
  }
  const matches = await repo.lookup([...requested]),
    bySurface = new Map<string, Lexeme[]>();
  for (const m of matches) {
    const bucket = bySurface.get(m.surface) ?? [];
    bucket.push(m);
    bySurface.set(m.surface, bucket);
  }
  const paths: Candidate[][] = Array.from(
    { length: chars.length + 1 },
    () => [],
  );
  paths[0] = [{ score: 0, tokens: [] }];
  const limit = o.limit ?? 1;
  for (let i = 0; i < chars.length; i++) {
    const separator = /[\s\p{P}\p{S}]/u.test(chars[i]);
    const blank: Token = {
      surface: chars[i],
      start: offsets[i],
      end: offsets[i + 1],
      kind: separator ? "separator" : "unknown",
      lemma: null,
      reading: null,
      romanization: null,
      entryId: null,
      pos: [],
      senses: [],
      senseIndices: [],
      conjugationSteps: [],
      components: [],
      alternatives: [],
    };
    const edges: { end: number; score: number; token: Token }[] = [
      { end: i + 1, score: separator ? 0 : -20, token: blank },
    ];
    for (const s of segments[i]) {
      const choices = bySurface.get(s.text);
      if (!choices?.length) continue;
      const sorted = [...choices].sort(
        (a, b) =>
          b.priority - a.priority ||
          a.cost - b.cost ||
          a.entryId.localeCompare(b.entryId),
      );
      const m = sorted[0];
      edges.push({
        end: s.end,
        score: (s.end - i) * 8 - 6 + Math.min(m.priority, 3) - m.cost,
        token: {
          ...blank,
          surface: s.text,
          end: offsets[s.end],
          kind: "word",
          lemma: m.lemma,
          reading: m.reading,
          romanization: romanizeKana(m.reading, o.romanization),
          entryId: m.entryId,
          pos: m.pos,
          senseIndices: m.senseIndices,
          conjugationSteps:
            o.includeConjugation === false ? [] : m.conjugationSteps,
          alternatives: sorted
            .slice(1, 21)
            .map((a) => ({
              ...a,
              conjugationSteps:
                o.includeConjugation === false ? [] : a.conjugationSteps,
            })),
        },
      });
    }
    for (const edge of edges) {
      const target = paths[edge.end];
      for (const p of paths[i])
        target.push({
          score: p.score + edge.score,
          tokens: [...p.tokens, edge.token],
        });
      target.sort((a, b) => b.score - a.score);
      target.splice(limit);
    }
  }
  const candidates = paths[chars.length],
    entries =
      o.includeGlosses === false
        ? []
        : await repo.entries([
            ...new Set(
              candidates.flatMap((c) =>
                c.tokens.flatMap((t) => (t.entryId ? [t.entryId] : [])),
              ),
            ),
          ]);
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const c of candidates)
    for (const t of c.tokens)
      if (t.entryId) {
        const e = byId.get(t.entryId);
        t.senses = e
          ? t.senseIndices.map((i) => e.senses[i]).filter(Boolean)
          : [];
      }
  return {
    text: o.text,
    offsetUnit: "utf16",
    engineVersion: ENGINE_VERSION,
    dictionary: metadata,
    candidates,
    warnings: [
      "Alpha morphology and heuristic scoring; not yet equivalent to Ichiran.",
      ...(candidates[0]?.tokens.some((t) => t.kind === "unknown")
        ? ["Some text was not found in the dictionary."]
        : []),
    ],
  };
}
