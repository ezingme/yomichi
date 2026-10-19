import { toHiragana as hira, toRomaji } from "wanakana";
import type { Romanization } from "./types.js";
export function toHiragana(text: string): string {
  return hira(text, { passRomaji: true });
}
/** Orthographic long vowels are retained (ou/oo), never guessed as macrons. */
export function romanizeKana(
  text: string,
  scheme: Romanization = "hepburn",
): string {
  const result = toRomaji(text);
  return scheme === "kunrei"
    ? result
        .replace(/sha/g, "sya")
        .replace(/shu/g, "syu")
        .replace(/sho/g, "syo")
        .replace(/cha/g, "tya")
        .replace(/chu/g, "tyu")
        .replace(/cho/g, "tyo")
        .replace(/shi/g, "si")
        .replace(/chi/g, "ti")
        .replace(/tsu/g, "tu")
        .replace(/fu/g, "hu")
        .replace(/ji/g, "zi")
        .replace(/ja/g, "zya")
        .replace(/ju/g, "zyu")
        .replace(/jo/g, "zyo")
    : result;
}
