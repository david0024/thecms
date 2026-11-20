/**
 * Extensions (ADR 0026), on the model of Zveltio's third-party extensions.
 *
 * An extension is one file: a manifest, the collections it keeps, the actions
 * that are its only code, and screens described as data. It declares what it
 * needs (its collections, the hosts it may call, where it appears in the
 * editor) and the owner accepts that before it is installed. The program
 * keeps its collections, runs its actions in a process of their own and draws
 * its screens. Who may do what is the program's rule, never the extension's.
 *
 * This file only reads and checks a package. Running one is `src/site/extensions.ts`.
 */
import { checkViews, type ViewDocument } from '../view/index.ts';
import { isObject, str } from './util.ts';

/** The format a package says it is in. */
export const EXTENSION_FORMAT = 'thecms.extension/1';
export const EXTENSION_MAX_BYTES = 5 * 1024 * 1024;

const NAME = /^[a-z][a-z0-9-]{1,39}$/;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$|^127\.0\.0\.1$/;

export const FIELD_KINDS = ['text', 'longtext', 'number', 'boolean', 'choice', 'secret', 'url'] as const;
export type ExtensionFieldKind = (typeof FIELD_KINDS)[number];

export interface ExtensionField {
  key: string;
  label: string;
  kind: ExtensionFieldKind;
  required: boolean;
  /** For a choice, what it may be. */
  options: string[];
  /** What a new row starts with. */
  initial: string | number | boolean | null;
}

export interface ExtensionCollection {
  name: string;
  label: string;
  fields: ExtensionField[];
}

/**
 * Where an action shows in the editor: on the block being edited, or on the
 * whole page. Its answer is put in the editor as a change the person sees and
 * saves, never written behind their back.
 */
export const EXTENSION_POINTS = ['block', 'page'] as const;
export type ExtensionPoint = (typeof EXTENSION_POINTS)[number];

/** Something the editor asks before it runs an action. */
export interface ExtensionAsk {
  key: string;
  label: string;
  kind: 'text' | 'language';
}

export interface ExtensionAction {
  name: string;
  label: string;
  /** Absent: run from the extension's own screen, by the owner. */
  on: ExtensionPoint | null;
  ask: ExtensionAsk[];
  /**
   * `language`: on a page of the main language, it runs once for each of the
   * site's other languages, on the page in that language, and what it gives
   * back fills in the words that translation does not say yet (ADR 0034).
   */
  each: 'language' | null;
  /** The collections it may read and write; nothing else. */
  reads: string[];
  writes: string[];
  timeoutSeconds: number;
}

export interface ExtensionManifest {
  name: string;
  displayName: string;
  description: string;
  version: string;
  publisher: string;
  /** The first version of this program it works with. */
  thecmsMinVersion: string;
  /** The hosts its code may call, and nothing else. */
  egress: string[];
  collections: ExtensionCollection[];
  actions: ExtensionAction[];
  /** Its screens, as data (ADR 0031): what they show and do, never how. */
  views: ViewDocument[];
  /** Its words, by language: `{ ro: { "Rewrite": "Rescrie" } }`. */
  messages: Record<string, Record<string, string>>;
}

export interface ExtensionPackage {
  manifest: ExtensionManifest;
  /** The actions, as one ES module: `export const actions = { name: async (input, host) => … }`. */
  code: string;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown, max: number): string => str(value, max).trim();

function field(raw: unknown, problems: string[], where: string): ExtensionField | null {
  if (!isObject(raw)) return null;
  const key = text(raw.key, 40);
  if (!KEY.test(key)) {
    problems.push(`${where}: a field's key is lower case letters, digits and _ ("${key}")`);
    return null;
  }
  const kind = FIELD_KINDS.find((k) => k === raw.kind);
  if (!kind) {
    problems.push(`${where}.${key}: a field is one of ${FIELD_KINDS.join(', ')}`);
    return null;
  }
  const options = kind === 'choice' ? list(raw.options).map((o) => text(o, 60)).filter(Boolean).slice(0, 40) : [];
  if (kind === 'choice' && options.length === 0) problems.push(`${where}.${key}: a choice needs its options`);
  const initial = raw.initial;
  const fit =
    initial === undefined || initial === null
      ? null
      : kind === 'boolean'
        ? initial === true
        : kind === 'number'
          ? Number.isFinite(initial) ? (initial as number) : null
          : kind === 'secret'
            ? null
            : text(initial, 2000);
  return { key, label: text(raw.label, 80) || key, kind, required: raw.required === true, options, initial: fit };
}

function collection(raw: unknown, problems: string[]): ExtensionCollection | null {
  if (!isObject(raw)) return null;
  const name = text(raw.name, 40);
  if (!KEY.test(name)) {
    problems.push(`a collection's name is lower case letters, digits and _ ("${name}")`);
    return null;
  }
  const fields: ExtensionField[] = [];
  for (const f of list(raw.fields).slice(0, 40)) {
    const one = field(f, problems, name);
    if (!one) continue;
    if (one.key === 'id' || fields.some((x) => x.key === one.key)) problems.push(`${name}.${one.key}: a field's key is used once, and never "id"`);
    else fields.push(one);
  }
  if (fields.length === 0) problems.push(`${name}: a collection has at least one field`);
  return { name, label: text(raw.label, 80) || name, fields };
}

function action(raw: unknown, names: string[], problems: string[]): ExtensionAction | null {
  if (!isObject(raw)) return null;
  const name = text(raw.name, 40);
  if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(name)) {
    problems.push(`an action's name is letters and digits ("${name}")`);
    return null;
  }
  const on = EXTENSION_POINTS.find((p) => p === raw.on) ?? null;
  if (raw.on !== undefined && raw.on !== null && !on) problems.push(`${name}: an action is on ${EXTENSION_POINTS.join(' or ')}, or on its own screen`);
  const own = (value: unknown, what: string): string[] =>
    list(value)
      .map((c) => text(c, 40))
      .filter((c) => {
        if (names.includes(c)) return true;
        problems.push(`${name}: it ${what} "${c}", which is not one of its collections`);
        return false;
      });
  const ask = list(raw.ask)
    .slice(0, 4)
    .flatMap((a): ExtensionAsk[] => {
      if (!isObject(a) || !KEY.test(text(a.key, 40))) return [];
      return [{ key: text(a.key, 40), label: text(a.label, 80) || text(a.key, 40), kind: a.kind === 'language' ? 'language' : 'text' }];
    });
  const seconds = Number(raw.timeoutSeconds);
  const each = raw.each === 'language' && on === 'page' ? 'language' : null;
  if (raw.each !== undefined && raw.each !== null && !each) problems.push(`${name}: an action runs for each language only on a page`);
  return {
    name,
    label: text(raw.label, 60) || name,
    on,
    ask,
    each,
    reads: own(raw.reads, 'reads'),
    writes: own(raw.writes, 'writes'),
    timeoutSeconds: Number.isInteger(seconds) && seconds >= 1 && seconds <= 300 ? seconds : 60,
  };
}

/** Reads a package, with every reason it cannot be installed. */
export function parseExtension(raw: unknown): { pkg: ExtensionPackage | null; problems: string[] } {
  const problems: string[] = [];
  if (!isObject(raw) || raw.format !== EXTENSION_FORMAT) return { pkg: null, problems: [`this is not an extension (${EXTENSION_FORMAT})`] };
  const m = isObject(raw.manifest) ? raw.manifest : {};
  const name = text(m.name, 40);
  if (!NAME.test(name)) problems.push(`an extension's name is lower case letters, digits and - ("${name}")`);
  const version = text(m.version, 40);
  if (!VERSION.test(version)) problems.push(`its version is like 1.0.0 ("${version}")`);
  const min = text(m.thecmsMinVersion, 40) || '0.0.0';
  if (!VERSION.test(min)) problems.push(`thecmsMinVersion is like 0.1.0 ("${min}")`);
  const egress = [...new Set(list(m.egress).map((h) => text(h, 253).toLowerCase()))].slice(0, 10);
  for (const host of egress) if (!HOST.test(host)) problems.push(`"${host}" is not a host name it may call`);

  const collections: ExtensionCollection[] = [];
  for (const c of list(m.collections).slice(0, 12)) {
    const one = collection(c, problems);
    if (!one) continue;
    if (collections.some((x) => x.name === one.name)) problems.push(`the collection "${one.name}" is declared twice`);
    else collections.push(one);
  }
  const names = collections.map((c) => c.name);
  const actions: ExtensionAction[] = [];
  for (const a of list(m.actions).slice(0, 24)) {
    const one = action(a, names, problems);
    if (!one) continue;
    if (actions.some((x) => x.name === one.name)) problems.push(`the action "${one.name}" is declared twice`);
    else actions.push(one);
  }
  // Screens are checked against thecms.view/1 and against what this manifest declares.
  const { views, problems: viewProblems } = checkViews(m.views, { collections: collections.map((c) => ({ name: c.name, fields: c.fields })), actions });
  problems.push(...viewProblems);
  const messages: Record<string, Record<string, string>> = {};
  if (isObject(m.messages)) {
    for (const [language, words] of Object.entries(m.messages).slice(0, 40)) {
      if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language) || !isObject(words)) continue;
      messages[language] = Object.fromEntries(
        Object.entries(words)
          .slice(0, 400)
          .map(([k, v]) => [str(k, 200), text(v, 400)]),
      );
    }
  }
  const code = typeof raw.code === 'string' ? raw.code : '';
  if (actions.length > 0 && !code.trim()) problems.push('it has actions and no code');
  if (code.length > EXTENSION_MAX_BYTES) problems.push('its code is larger than 5 MB');
  if (problems.length) return { pkg: null, problems };
  return {
    pkg: {
      manifest: {
        name,
        displayName: text(m.displayName, 60) || name,
        description: text(m.description, 400),
        version,
        publisher: text(m.publisher, 80),
        thecmsMinVersion: min,
        egress,
        collections,
        actions,
        views,
        messages,
      },
      code,
    },
    problems,
  };
}

/** May this host be called by an extension that declared these? `*.example.com` covers its subdomains, not itself. */
export function egressAllows(declared: readonly string[], host: string): boolean {
  const h = host.toLowerCase();
  return declared.some((d) => (d.startsWith('*.') ? h.endsWith(d.slice(1)) && h.length > d.length - 1 : h === d));
}

/** What the owner is asked to accept, in plain words, before an extension is installed. */
export function extensionAsks(manifest: ExtensionManifest): { collections: string[]; secrets: string[]; egress: string[]; points: { action: string; on: ExtensionPoint }[] } {
  return {
    collections: manifest.collections.map((c) => c.label),
    secrets: manifest.collections.flatMap((c) => c.fields.filter((f) => f.kind === 'secret').map((f) => `${c.label}: ${f.label}`)),
    egress: manifest.egress,
    points: manifest.actions.flatMap((a) => (a.on ? [{ action: a.label, on: a.on }] : [])),
  };
}

/** An extension's word in a language, or the word itself. */
export const extensionWord = (manifest: ExtensionManifest, language: string, word: string): string => manifest.messages[language]?.[word] || manifest.messages[language.split('-')[0] as string]?.[word] || word;

/** A row of a collection, cleaned by its fields: what is not a field is dropped, each value fits its kind. */
export function cleanRow(of: ExtensionCollection, raw: unknown, before: Record<string, unknown> | null = null): { row: Record<string, unknown>; problems: string[] } {
  const input = isObject(raw) ? raw : {};
  const row: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const f of of.fields) {
    const given = f.key in input ? input[f.key] : before ? before[f.key] : f.initial;
    let value: unknown;
    switch (f.kind) {
      case 'boolean':
        value = given === true;
        break;
      case 'number':
        value = typeof given === 'number' && Number.isFinite(given) ? given : typeof given === 'string' && given.trim() !== '' && Number.isFinite(Number(given)) ? Number(given) : null;
        break;
      case 'choice':
        value = f.options.includes(String(given)) ? String(given) : null;
        break;
      case 'secret':
        // A secret is never shown again; an empty one keeps what was there.
        value = typeof given === 'string' && given !== '' ? str(given, 4000) : (before?.[f.key] ?? '');
        break;
      case 'url': {
        const url = text(given, 2000);
        value = url === '' || /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
        if (value === null) problems.push(`${f.label}: an address starts with https://`);
        break;
      }
      default:
        value = text(given, f.kind === 'longtext' ? 100_000 : 2000);
    }
    if (f.required && (value === null || value === '')) problems.push(`${f.label} is needed`);
    row[f.key] = value ?? (f.kind === 'url' ? '' : null);
  }
  return { row, problems };
}

/** A row as the admin sees it: a secret only says whether it is set. */
export const shownRow = (of: ExtensionCollection, row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, of.fields.find((f) => f.key === k)?.kind === 'secret' ? (v ? '••••••' : '') : v]));
