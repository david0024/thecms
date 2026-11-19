/**
 * The language packs this installation has (ADR 0021): the ones that ship
 * (`languages/`, inside the program), and any in the folder THECMS_LANGUAGES
 * names, read when the program starts. Each is checked against English before it is used; what
 * does not fit is left out, and said once on the console.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Catalog, type LanguagePack, packCoverage, parsePack } from '../core/index.ts';
import { en as admin } from '../admin/messages.ts';
import { en as site, useSitePacks } from '../blocks/words.ts';
import { SHIPPED_LANGUAGES } from './shipped.ts';

/** Every word thecms says, in English: what every pack is checked against, and what a pack leaves out falls back to. */
export const ENGLISH = { admin, site } as unknown as Catalog;

export interface LanguageInfo {
  language: string;
  name: string;
  /** How much of English the pack says, from 0 to 1. */
  coverage: number;
}

/**
 * The packs that ship, then those in these folders, checked. A later pack of
 * a language replaces an earlier one's.
 */
export function readLanguages(folders: string[], shipped: Record<string, unknown> = SHIPPED_LANGUAGES): { packs: LanguagePack[]; problems: string[] } {
  const found = new Map<string, LanguagePack>();
  const problems: string[] = [];
  const take = (file: string, raw: unknown): void => {
    const { pack, issues } = parsePack(raw, ENGLISH);
    for (const issue of issues) problems.push(`${file}: ${issue.key ? `${issue.key}: ` : ''}${issue.message}`);
    if (pack) found.set(pack.language, pack);
  };
  for (const file of Object.keys(shipped).sort()) take(file, shipped[file]);
  for (const folder of folders) {
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder).filter((f) => f.endsWith('.json')).sort()) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(join(folder, file), 'utf8'));
      } catch (error) {
        problems.push(`${file}: not JSON (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }
      take(file, raw);
    }
  }
  return { packs: [...found.values()], problems };
}

const loaded = readLanguages([process.env.THECMS_LANGUAGES ?? ''].filter(Boolean));
if (loaded.problems.length) console.error(`Language packs: ${loaded.problems.length} messages were left out.\n${loaded.problems.map((p) => `  ${p}`).join('\n')}`);
useSitePacks(loaded.packs);

/** The pack for a language, by its code or the language it belongs to (`pt` for `pt-BR`), or null for English. */
export function packFor(language: string): LanguagePack | null {
  return loaded.packs.find((p) => p.language === language) ?? loaded.packs.find((p) => p.language === language.split('-')[0]) ?? null;
}

/** The languages the admin and the site can be in: English, then every pack. */
export const languages = (): LanguageInfo[] => [
  { language: 'en', name: 'English', coverage: 1 },
  ...loaded.packs.map((pack) => ({ language: pack.language, name: pack.name, coverage: packCoverage(pack, ENGLISH) })).sort((a, b) => a.name.localeCompare(b.name)),
];
