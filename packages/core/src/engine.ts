import { normalizeJapanese } from "./characters.js";
import { findCounterCandidates } from "./counters.js";
import { grammarExtensions, connectionScore } from "./grammar.js";
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
    ![
      "hepburn",
      "kunrei",
      "hepburn-basic",
      "hepburn-simple",
      "hepburn-passport",
      "hepburn-traditional",
      "hepburn-modified",
      "kunrei-shiki",
    ].includes(o.romanization)
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
  const offsetIndex = new Map(offsets.map((offset, index) => [offset, index]));
  const hints = new Set(o.segmentationHints ?? []),
    requested = new Set<string>();
  const segments: {
    end: number;
    text: string;
    lookup: string;
    virtual?: boolean;
  }[][] = chars.map(() => []);
  const isSeparator = (c: string) =>
    /[\s\p{P}\p{S}]/u.test(c) && !/[々〆]/u.test(c);
  for (let i = 0; i < chars.length; i++) {
    if (isSeparator(chars[i])) continue;
    let value = "";
    for (let j = i; j < Math.min(chars.length, i + 50); j++) {
      if (j > i && (hints.has(offsets[j]) || isSeparator(chars[j]))) break;
      value += chars[j];
      const lookup = normalizeJapanese(value);
      requested.add(lookup);
      segments[i].push({ end: j + 1, text: value, lookup });
      const tail = o.text.slice(offsets[j + 1]);
      const connector = tail.startsWith("ちゃ")
        ? "て"
        : tail.startsWith("じゃ")
          ? "で"
          : null;
      if (connector && j + 2 < offsets.length) {
        requested.add(lookup + connector);
        segments[i].push({
          end: j + 2,
          text: value + connector,
          lookup: lookup + connector,
          virtual: true,
        });
      }
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
  // Beam retains lexical states as well as segmentation alternatives.
  const beam = Math.max(16, limit * 8);
  function blank(start: number, end: number): Token {
    return {
      surface: o.text.slice(start, end),
      start,
      end,
      kind: "word",
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
  }
  const allowed = (start: number, end: number) =>
    ![...hints].some((h) => h > start && h < end) &&
    !Array.from(o.text.slice(start, end)).some(isSeparator);
  for (let i = 0; i < chars.length; i++) {
    const separator = isSeparator(chars[i]);
    const edges: { end: number; score: number; token: Token }[] = [
      {
        end: i + 1,
        score: separator ? 0 : -20,
        token: {
          ...blank(offsets[i], offsets[i + 1]),
          kind: separator ? "separator" : "unknown",
        },
      },
    ];
    const virtualRoots: typeof edges = [];
    for (const s of segments[i]) {
      const choices = bySurface.get(s.lookup);
      if (!choices?.length) continue;
      const sorted = [...choices].sort(
        (a, b) =>
          b.priority - a.priority ||
          a.cost - b.cost ||
          a.entryId.localeCompare(b.entryId),
      );
      // Keep distinct readings/inflections: homographs must survive context scoring.
      for (const m of sorted.slice(0, 8)) {
        (s.virtual ? virtualRoots : edges).push({
          end: s.end,
          score: (s.end - i) * 8 - 10 + Math.min(m.priority, 3) - m.cost,
          token: {
            ...blank(offsets[i], offsets[s.end]),
            surface: s.text,
            lemma: m.lemma,
            reading: m.reading,
            entryId: m.entryId,
            pos: m.pos,
            senseIndices: m.senseIndices,
            conjugationSteps: m.conjugationSteps,
            alternatives: sorted.filter((a) => a !== m).slice(0, 20),
          },
        });
      }
    }
    if (!separator) {
      // Counter definitions are grammatical pronunciation rules, not invented entries.
      const custom = matches
        .filter((m) => m.pos.includes("ctr") && !m.conjugationSteps.length)
        .map((m) => ({ surface: m.surface, reading: m.reading }));
      for (const c of findCounterCandidates(
        o.text.slice(
          0,
          Math.min(...[...hints].filter((h) => h > offsets[i]), o.text.length),
        ),
        offsets[i],
        custom,
      )) {
        const end = offsetIndex.get(c.end);
        if (end === undefined || !allowed(c.start, c.end)) continue;
        const token: Token = {
          ...blank(c.start, c.end),
          reading: c.reading,
          lemma: c.surface,
          pos: [c.counter ? "ctr" : "num"],
          conjugationSteps: c.ordinal ? ["ordinal"] : [],
          components: c.components.map((part) => ({
            ...blank(part.start, part.end),
            reading: part.reading,
            pos: [part.kind],
          })),
        };
        edges.push({ end, score: (end - i) * 8 - 4, token });
      }
      let frontier = [
        ...edges.filter((e) => e.token.kind === "word"),
        ...virtualRoots,
      ];
      const seen = new Set(
        frontier.map((e) =>
          JSON.stringify([e.end, e.token.reading, e.token.conjugationSteps]),
        ),
      );
      for (let depth = 0; depth < 3 && frontier.length; depth++) {
        const next: typeof edges = [];
        for (const edge of frontier)
          for (const token of grammarExtensions(edge.token, o.text)) {
            const end = offsetIndex.get(token.end);
            if (
              end === undefined ||
              end - i > 50 ||
              !allowed(token.start, token.end)
            )
              continue;
            const key = JSON.stringify([
              end,
              token.reading,
              token.conjugationSteps,
            ]);
            if (seen.has(key)) continue;
            seen.add(key);
            // Standalone-stem penalty is released once a valid suffix consumes it.
            const stem = ["continuative", "adjective stem"].includes(
              edge.token.conjugationSteps.at(-1) ?? "",
            );
            const score =
              edge.score + (end - edge.end) * 8 - 1 + (stem ? 8 : 0);
            next.push({ end, score, token });
          }
        next.sort((a, b) => b.score - a.score);
        next.splice(128);
        edges.push(...next);
        frontier = next;
      }
    }
    for (const edge of edges) {
      const target = paths[edge.end];
      for (const path of paths[i])
        target.push({
          score:
            path.score +
            edge.score +
            connectionScore(path.tokens.at(-1), edge.token),
          tokens: [...path.tokens, edge.token],
        });
      target.sort((a, b) => b.score - a.score);
      const seen = new Set<string>();
      const unique = target.filter((p) => {
        const key = p.tokens
          .map((t) =>
            [t.end, t.entryId, t.reading, t.conjugationSteps.join(",")].join(
              ":",
            ),
          )
          .join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      target.splice(0, target.length, ...unique.slice(0, beam));
    }
  }
  // Public candidates are distinct segmentations; lexical ambiguity lives on tokens.
  const used = new Set<string>();
  const candidates = paths[chars.length]
    .filter((c) => {
      const key = c.tokens.map((t) => t.end).join(",");
      if (used.has(key)) return false;
      used.add(key);
      return true;
    })
    .slice(0, limit);
  const flatten = (tokens: Token[]): Token[] =>
    tokens.flatMap((t) => [t, ...flatten(t.components)]);
  const allTokens = candidates.flatMap((c) => flatten(c.tokens));
  const entries =
    o.includeGlosses === false
      ? []
      : await repo.entries([
          ...new Set(allTokens.flatMap((t) => (t.entryId ? [t.entryId] : []))),
        ]);
  const byId = new Map(entries.map((e) => [e.id, e]));
  // Tokens may be shared by paths. Clone before applying response projections.
  function project(t: Token): Token {
    const e = t.entryId ? byId.get(t.entryId) : undefined;
    return {
      ...t,
      romanization: t.reading ? romanizeKana(t.reading, o.romanization) : null,
      senses: e ? t.senseIndices.map((i) => e.senses[i]).filter(Boolean) : [],
      conjugationSteps:
        o.includeConjugation === false ? [] : t.conjugationSteps,
      alternatives: t.alternatives.map((a) => ({
        ...a,
        conjugationSteps:
          o.includeConjugation === false ? [] : a.conjugationSteps,
      })),
      components: t.components.map(project),
    };
  }
  return {
    text: o.text,
    offsetUnit: "utf16",
    engineVersion: ENGINE_VERSION,
    dictionary: metadata,
    candidates: candidates.map((c) => ({
      ...c,
      tokens: c.tokens.map(project),
    })),
    warnings: [
      "Rule-based morphology and bounded heuristic search; Ichiran result parity is not yet established.",
      ...(candidates[0]?.tokens.some((t) => t.kind === "unknown")
        ? ["Some text was not found in the dictionary."]
        : []),
    ],
  };
}
