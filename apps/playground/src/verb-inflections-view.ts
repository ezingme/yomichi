import {
  YomichiClient,
  YomichiClientError,
  type DictionaryVerbInflections,
  type VerbInflectionRequest,
  type VerbInflectionDetail,
} from "../../../packages/client/src/index.js";
import type { Locale } from "./i18n.js";
const labels = {
  en: {
    core: "Verb inflections",
    extra: "Expressions",
    positive: "Affirmative",
    negative: "Negative",
    select: "Select a dictionary meaning",
    copy: "Copy",
    copied: "Copied",
    unavailable: "Not applicable",
    context: "Context dependent",
    notes: "Usage notes (Chinese)",
    failed: "Copy failed",
  },
  zh: {
    core: "动词活用",
    extra: "扩展表达",
    positive: "肯定",
    negative: "否定",
    select: "选择词典义项",
    copy: "复制",
    copied: "已复制",
    unavailable: "不适用",
    context: "需结合语境",
    notes: "用法说明",
    failed: "复制失败",
  },
  ja: {
    core: "動詞の活用",
    extra: "関連表現",
    positive: "肯定",
    negative: "否定",
    select: "辞書の語義を選択",
    copy: "コピー",
    copied: "コピー済み",
    unavailable: "該当なし",
    context: "文脈による",
    notes: "用法説明（中国語）",
    failed: "コピー失敗",
  },
};
const rowNames: Record<string, [string, string]> = {
  nonpast: ["Non-past · plain", "非過去（普通形）"],
  "nonpast-polite": ["Non-past · polite", "非過去（丁寧形）"],
  past: ["Past · plain", "過去（普通形）"],
  "past-polite": ["Past · polite", "過去（丁寧形）"],
  te: ["Te-form", "て形"],
  volitional: ["Volitional / conjectural", "意向・推量"],
  ba: ["Ba conditional", "ば形"],
  imperative: ["Imperative / prohibitive", "命令・禁止"],
  potential: ["Potential", "可能"],
  passive: ["Passive", "受身"],
  causative: ["Causative", "使役"],
  "causative-passive": ["Causative passive", "使役受身"],
  tara: ["Tara conditional", "たら条件"],
  desiderative: ["Desire", "願望"],
  conjectural: ["Conjecture", "推量"],
  progressive: ["Progressive / state", "進行・状態"],
  "progressive-polite": [
    "Progressive / state · polite",
    "進行・状態（丁寧形）",
  ],
};
const el = (tag: string, text = "", className = "") => {
  const e = document.createElement(tag);
  e.textContent = text;
  e.className = className;
  return e;
};
export function renderVerbInflections(
  container: HTMLElement,
  result: DictionaryVerbInflections,
  locale: Locale,
) {
  const t = labels[locale];
  container.replaceChildren(
    el("h3", `${result.word} · ${result.reading}`),
    el(
      "p",
      `${result.pos} · #${result.entryId} · ${result.senseIds.join(", ")}`,
      "muted",
    ),
  );
  function group(title: string, rows: VerbInflectionDetail[]) {
    container.append(el("h4", title));
    for (const row of rows) {
      const details = el("details", "", "verb-row");
      const summary = el("summary");
      summary.append(
        el(
          "span",
          locale === "zh"
            ? row.label
            : (rowNames[row.id]?.[locale === "en" ? 0 : 1] ?? row.label),
          "verb-label",
        ),
      );
      for (const [heading, values] of [
        [t.positive, row.positive],
        [t.negative, row.negative],
      ] as const) {
        const cell = el("span", "", "verb-cell");
        cell.append(el("small", heading));
        cell.append(el("span", values[0]?.surface ?? "—", "verb-surface"));
        if (values[0])
          cell.append(el("small", values[0].reading, "verb-reading"));
        summary.append(cell);
      }
      details.append(summary);
      if (row.availability !== "productive")
        details.append(
          el(
            "p",
            row.availability === "not-applicable" ? t.unavailable : t.context,
            "muted",
          ),
        );
      details.append(el("small", t.notes), el("p", row.note));
      for (const [heading, values] of [
        [t.positive, row.positive],
        [t.negative, row.negative],
      ] as const) {
        for (const v of values) {
          const line = el("p", "", "verb-variant");
          line.append(
            el(
              "span",
              `${heading}: ${v.surface} (${v.reading}) · ${v.register}`,
            ),
          );
          const copy = el("button", t.copy) as HTMLButtonElement;
          copy.type = "button";
          copy.setAttribute("aria-label", `${t.copy} ${v.surface}`);
          copy.onclick = async () => {
            try {
              await navigator.clipboard.writeText(v.surface);
              copy.textContent = t.copied;
            } catch {
              copy.textContent = t.failed;
            }
          };
          line.append(copy);
          details.append(line);
          if (v.note) details.append(el("p", v.note, "muted"));
        }
      }
      if (row.example)
        details.append(
          el(
            "p",
            `[${row.example.word}] ${row.example.japanese} ${row.example.chinese}`,
          ),
        );
      container.append(details);
    }
  }
  group(t.core, result.details);
  group(t.extra, result.extensions);
}
/** Each invocation owns its detached-able result container, so a late response
 * cannot overwrite results of a later query or another tool. */
export async function loadVerbInflections(
  container: HTMLElement,
  client: YomichiClient,
  request: VerbInflectionRequest,
  locale: Locale,
  onResult: (request: VerbInflectionRequest, response: unknown) => void,
): Promise<void> {
  try {
    const result = await client.verbInflections(request);
    renderVerbInflections(container, result, locale);
    onResult(request, result);
  } catch (error) {
    if (
      !(error instanceof YomichiClientError) ||
      error.code !== "AMBIGUOUS_VERB"
    )
      throw error;
    container.replaceChildren(el("h3", labels[locale].select));
    onResult(request, {
      error: { code: error.code, message: error.message },
      candidates: error.candidates,
    });
    for (const candidate of error.candidates) {
      const button = el(
        "button",
        `${candidate.spellings.join(" / ")} · ${candidate.reading} · ${candidate.pos} · #${candidate.entryId} ${candidate.glosses.join("; ")}`,
        "verb-choice",
      ) as HTMLButtonElement;
      button.type = "button";
      button.onclick = async () => {
        // Disable the whole candidate set to prevent competing responses.
        container
          .querySelectorAll("button")
          .forEach((b) => (b.disabled = true));
        try {
          await loadVerbInflections(
            container,
            client,
            {
              ...request,
              entryId: candidate.entryId,
              reading: candidate.reading,
              senseId: candidate.senseIds[0],
              pos: candidate.pos,
            },
            locale,
            onResult,
          );
        } catch (e) {
          const message = el("p", (e as Error).message, "error");
          message.setAttribute("role", "alert");
          container.append(message);
          container
            .querySelectorAll("button")
            .forEach((b) => (b.disabled = false));
        }
      };
      container.append(button);
    }
  }
}
