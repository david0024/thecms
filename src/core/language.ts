/**
 * Language packs (ADR 0021): every word the admin and the site say, in one
 * flat JSON file per language, as data.
 *
 *   { "$language": "ro", "$name": "Română",
 *     "site.menu": "Meniu",
 *     "admin.design.heading": "Pagina fiecărui {singular}",
 *     "admin.ctypes.entries": { "one": "1 intrare", "few": "{count} intrări", "other": "{count} de intrări" } }
 *
 * The keys are the paths of the English words, which are built in and are
 * what every pack is checked against. A message keeps the same {placeholders}
 * as the English one. A message that depends on a number gives the forms its
 * language needs (Intl.PluralRules: zero, one, two, few, many, other), and
 * always `other`. A key a pack leaves out is said in English.
 */

export type Plural = Partial<Record<'zero' | 'one' | 'two' | 'few' | 'many', string>> & { other: string };
export type Message = string | Plural;
export interface Catalog {
  [key: string]: Message | Catalog;
}

export interface LanguagePack {
  language: string;
  name: string;
  messages: Record<string, Message>;
}

export interface PackIssue {
  key: string;
  message: string;
}

const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const MAX_TEXT = 2000;
const MAX_MESSAGES = 5000;

export const isPlural = (value: unknown): value is Plural =>
  !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Plural).other === 'string' && Object.keys(value).every((k) => (PLURAL_FORMS as readonly string[]).includes(k));

/** The names a message fills in, in the order they first appear. */
export function placeholders(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : Object.values(message);
  const found = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(/\{(\w+)\}/g)) found.add(match[1] as string);
  return [...found];
}

/** A message with its places filled. A plural message picks its form by `count`, in the rules of `language`. */
export function format(message: Message, params: Record<string, string | number> = {}, language = 'en'): string {
  let text: string;
  if (typeof message === 'string') text = message;
  else {
    const count = Number(params.count ?? 0);
    let form: string = 'other';
    try {
      form = count === 0 && message.zero !== undefined ? 'zero' : new Intl.PluralRules(language).select(count);
    } catch {
      // A language the runtime does not know is given the form `other`.
    }
    text = message[form as keyof Plural] ?? message.other;
  }
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** Every message of a catalog by its path, `admin.app.pages`. */
export function flattenCatalog(catalog: Catalog, prefix = ''): Record<string, Message> {
  const out: Record<string, Message> = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string' || isPlural(value)) out[path] = value;
    else Object.assign(out, flattenCatalog(value as Catalog, path));
  }
  return out;
}

/** The catalog with a pack's messages put in place of the English ones. What the pack leaves out stays English. */
export function applyPack<T extends Catalog>(catalog: T, pack: LanguagePack | null, prefix = ''): T {
  if (!pack) return catalog;
  const out: Catalog = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string' || isPlural(value)) out[key] = pack.messages[path] ?? value;
    else out[key] = applyPack(value as Catalog, pack, path);
  }
  return out as T;
}

const cleanText = (value: string): string => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, MAX_TEXT);

/**
 * A pack as it may be used, checked against the English catalog. What does
 * not fit is left out and named: a key English does not have, a message whose
 * places are not English's, a plural where English has none or the other way
 * round. A pack without a language code is not a pack.
 */
export function parsePack(raw: unknown, base: Catalog): { pack: LanguagePack | null; issues: PackIssue[] } {
  const issues: PackIssue[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { pack: null, issues: [{ key: '', message: 'a language pack is a JSON object' }] };
  const input = raw as Record<string, unknown>;
  const language = typeof input.$language === 'string' && LANGUAGE.test(input.$language) ? input.$language : '';
  if (!language) return { pack: null, issues: [{ key: '$language', message: 'a language pack names its language, like "ro" or "pt-BR"' }] };
  const name = typeof input.$name === 'string' && input.$name.trim() ? cleanText(input.$name.trim()).slice(0, 60) : language;
  const english = flattenCatalog(base);
  const messages: Record<string, Message> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith('$')) continue;
    if (Object.keys(messages).length >= MAX_MESSAGES) {
      issues.push({ key, message: `a pack holds at most ${MAX_MESSAGES} messages` });
      break;
    }
    const want = english[key];
    if (want === undefined) {
      issues.push({ key, message: 'English has no such message' });
      continue;
    }
    let message: Message;
    if (typeof want === 'string') {
      if (typeof value !== 'string') {
        issues.push({ key, message: 'this message is text, not forms for a number' });
        continue;
      }
      message = cleanText(value);
    } else {
      if (!isPlural(value)) {
        issues.push({ key, message: `this message depends on a number: give its forms (${PLURAL_FORMS.join(', ')}), with "other" always` });
        continue;
      }
      message = Object.fromEntries(Object.entries(value).map(([form, text]) => [form, cleanText(String(text))])) as Plural;
    }
    const mine = placeholders(message).sort();
    const theirs = placeholders(want).sort();
    if (mine.join() !== theirs.join()) {
      issues.push({ key, message: `fills in ${mine.length ? mine.map((p) => `{${p}}`).join(' ') : 'nothing'}, where English fills in ${theirs.length ? theirs.map((p) => `{${p}}`).join(' ') : 'nothing'}` });
      continue;
    }
    if (!(typeof message === 'string' ? message : message.other).trim()) continue;
    messages[key] = message;
  }
  return { pack: { language, name, messages }, issues };
}

/** How much of English a pack says, from 0 to 1. */
export const packCoverage = (pack: LanguagePack, base: Catalog): number => {
  const all = Object.keys(flattenCatalog(base)).length;
  return all ? Object.keys(pack.messages).length / all : 1;
};
