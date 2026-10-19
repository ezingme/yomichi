import type {
  DictionaryRepository,
  Entry,
  Lexeme,
  Kanji,
  DictionaryMetadata,
} from "../packages/core/src/types.js";
import { generateForms } from "../packages/core/src/conjugation.js";
export function entry(
  id: string,
  word: string,
  reading: string,
  pos: string,
): Entry {
  return {
    id,
    spellings: [word],
    readings: [{ text: reading, restrictions: [] }],
    senses: [
      {
        pos: [pos],
        glosses: [{ language: "eng", text: `test definition of ${word}` }],
        restrictions: [],
        readingRestrictions: [],
      },
    ],
    priority: 1,
  };
}
export class MemoryDictionary implements DictionaryRepository {
  forms: Lexeme[];
  constructor(public words: Entry[]) {
    this.forms = words.flatMap(generateForms);
  }
  async metadata(): Promise<DictionaryMetadata> {
    return {
      version: "synthetic-test-only",
      source: "test",
      entryCount: this.words.length,
      capabilities: ["words"],
    };
  }
  async lookup(forms: string[]) {
    const set = new Set(forms);
    return this.forms.filter((f) => set.has(f.surface));
  }
  async entries(ids: string[]) {
    return this.words.filter((e) => ids.includes(e.id));
  }
  async search(q: string, limit: number) {
    return this.words
      .filter(
        (e) =>
          e.spellings.some((s) => s.includes(q)) ||
          e.readings.some((r) => r.text.includes(q)),
      )
      .slice(0, limit);
  }
  async kanji(_char: string): Promise<Kanji | null> {
    return null;
  }
}
