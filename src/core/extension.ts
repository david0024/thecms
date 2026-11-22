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

/** The format a package is written in now: the second, with what the program tells, asks and lends (ADR 0062). */
export const EXTENSION_FORMAT = 'thecms.extension/3';
/** The second format (ADR 0041), still read: routes, jobs and the events of the site's changes. */
export const EXTENSION_FORMAT_2 = 'thecms.extension/2';
/** The first format (ADR 0026), still read: a package in it has no routes, jobs or events. */
export const EXTENSION_FORMAT_1 = 'thecms.extension/1';
const FORMATS: readonly string[] = [EXTENSION_FORMAT, EXTENSION_FORMAT_2, EXTENSION_FORMAT_1];
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
  /**
   * It may see the site's pictures (ADR 0059 d3): `host.picture` gives it the
   * bytes of a picture of the library, and the owner is told so before installing.
   */
  pictures: boolean;
  /** The program's data it reads (ADR 0062 d4), of those the manifest declares. */
  uses: ProgramData[];
  timeoutSeconds: number;
}

/** The program's data an extension may read, declared (ADR 0062 d4). */
export const PROGRAM_DATA = ['published'] as const;
export type ProgramData = (typeof PROGRAM_DATA)[number];

/** The questions the program asks an extension and waits for (ADR 0062 d3), and what each may answer. */
export const QUESTIONS = { 'comment.check': ['hold', 'approve', 'spam'] } as const;
export type Question = keyof typeof QUESTIONS;
/** How long the program waits for an answer before it goes on without it. */
export const ANSWER_SECONDS = 10;

export interface ExtensionAnswer {
  question: Question;
  action: string;
}

/**
 * A public address of the extension (ADR 0041): `/_/x/<extension>/<path>` on
 * the site's runtime, answered by one of its actions. A payment provider's
 * confirmation, a webhook.
 */
export interface ExtensionRoute {
  path: string;
  action: string;
  methods: ('GET' | 'POST')[];
}

/** Work the site's clock does at an interval, such as syncing stock. */
export interface ExtensionJob {
  action: string;
  everyMinutes: number;
}

/** What happens in the site that an extension may hear of, and what it is told. */
export const EXTENSION_EVENTS = ['page.published', 'entry.published', 'comment.created', 'comment.approved', 'message.received', 'page.served', 'search.made'] as const;
/** What the second format may listen to: the site's changes, not its visits. */
const EVENTS_2: readonly string[] = EXTENSION_EVENTS.slice(0, 5);
/**
 * Told in batches, every few seconds, as `{ event, items: [...] }` (ADR 0062 d2):
 * a visit does not wake an extension.
 */
export const BATCHED_EVENTS: readonly ExtensionEventName[] = ['page.served', 'search.made'];
export type ExtensionEventName = (typeof EXTENSION_EVENTS)[number];

export interface ExtensionListener {
  on: ExtensionEventName;
  action: string;
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
  /** Its public addresses, its work at intervals and what it listens to (ADR 0041). */
  routes: ExtensionRoute[];
  jobs: ExtensionJob[];
  events: ExtensionListener[];
  /** The questions it answers, and the program's data it reads (ADR 0062). */
  answers: ExtensionAnswer[];
  uses: ProgramData[];
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
    pictures: raw.pictures === true,
    uses: PROGRAM_DATA.filter((d) => list(raw.uses).includes(d)),
    timeoutSeconds: Number.isInteger(seconds) && seconds >= 1 && seconds <= 300 ? seconds : 60,
  };
}

const ROUTE = /^[a-z0-9][a-z0-9-]{0,39}(\/[a-z0-9][a-z0-9-]{0,39}){0,3}$/;

/**
 * Routes, jobs and events each name an action that runs on its own, not one
 * the editor offers on a block or a page: what it is given is not a page.
 */
function serverParts(m: Record<string, unknown>, actions: ExtensionAction[], problems: string[], format: string): Pick<ExtensionManifest, 'routes' | 'jobs' | 'events'> {
  const own = (name: unknown, what: string): string | null => {
    const action = actions.find((a) => a.name === text(name, 40));
    if (!action) problems.push(`${what} runs "${text(name, 40)}", which is not one of its actions`);
    else if (action.on) problems.push(`${what} runs "${action.name}", which the editor offers on a ${action.on}`);
    return action && !action.on ? action.name : null;
  };
  const routes: ExtensionRoute[] = [];
  for (const r of list(m.routes).slice(0, 12)) {
    if (!isObject(r)) continue;
    const path = text(r.path, 200).replace(/^\/+|\/+$/g, '');
    if (!ROUTE.test(path)) {
      problems.push(`a route's path is lower case words joined by / ("${path}")`);
      continue;
    }
    if (routes.some((x) => x.path === path)) {
      problems.push(`the route "${path}" is declared twice`);
      continue;
    }
    const action = own(r.action, `the route "${path}"`);
    const methods = (['GET', 'POST'] as const).filter((x) => list(r.methods).map((y) => text(y, 10).toUpperCase()).includes(x));
    if (action) routes.push({ path, action, methods: methods.length ? methods : ['POST'] });
  }
  const jobs: ExtensionJob[] = [];
  for (const j of list(m.jobs).slice(0, 12)) {
    if (!isObject(j)) continue;
    const every = Number(j.everyMinutes);
    const action = own(j.action, 'a job');
    if (!Number.isInteger(every) || every < 1 || every > 10_080) problems.push(`a job runs every 1 to 10080 minutes ("${String(j.everyMinutes)}")`);
    else if (action && jobs.some((x) => x.action === action)) problems.push(`the job "${action}" is declared twice`);
    else if (action) jobs.push({ action, everyMinutes: every });
  }
  const events: ExtensionListener[] = [];
  for (const e of list(m.events).slice(0, 24)) {
    if (!isObject(e)) continue;
    const heard = format === EXTENSION_FORMAT ? EXTENSION_EVENTS : EVENTS_2;
    const on = EXTENSION_EVENTS.find((x) => x === e.on && heard.includes(x));
    if (!on) {
      problems.push(`an extension listens to one of ${heard.join(', ')} ("${text(e.on, 40)}")`);
      continue;
    }
    const action = own(e.action, `listening to ${on}`);
    if (action && !events.some((x) => x.on === on && x.action === action)) events.push({ on, action });
  }
  return { routes, jobs, events };
}

/** What the third format adds (ADR 0062): the questions it answers and the program's data it reads. */
function thirdParts(m: Record<string, unknown>, actions: ExtensionAction[], problems: string[]): Pick<ExtensionManifest, 'answers' | 'uses'> {
  const uses = PROGRAM_DATA.filter((d) => list(m.uses).includes(d));
  for (const u of list(m.uses)) if (!PROGRAM_DATA.includes(u as ProgramData)) problems.push(`an extension reads ${PROGRAM_DATA.join(', ')} of the program's data ("${text(u, 40)}")`);
  for (const a of actions) for (const u of a.uses) if (!uses.includes(u)) problems.push(`${a.name}: it reads "${u}", which the extension does not declare in "uses"`);
  const answers: ExtensionAnswer[] = [];
  for (const q of list(m.answers).slice(0, 12)) {
    if (!isObject(q)) continue;
    const question = Object.keys(QUESTIONS).find((x) => x === q.question) as Question | undefined;
    if (!question) {
      problems.push(`an extension answers one of ${Object.keys(QUESTIONS).join(', ')} ("${text(q.question, 40)}")`);
      continue;
    }
    const action = actions.find((a) => a.name === text(q.action, 40));
    if (!action) problems.push(`answering ${question} runs "${text(q.action, 40)}", which is not one of its actions`);
    else if (action.on) problems.push(`answering ${question} runs "${action.name}", which the editor offers on a ${action.on}`);
    else if (answers.some((x) => x.question === question)) problems.push(`it answers ${question} twice`);
    else answers.push({ question, action: action.name });
  }
  return { answers, uses };
}

/** Reads a package, with every reason it cannot be installed. */
export function parseExtension(raw: unknown): { pkg: ExtensionPackage | null; problems: string[] } {
  const problems: string[] = [];
  if (!isObject(raw) || typeof raw.format !== 'string' || !FORMATS.includes(raw.format)) return { pkg: null, problems: [`this is not an extension (${EXTENSION_FORMAT})`] };
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
  // The first format has none of these: what such a package says of them is not read.
  const server = raw.format !== EXTENSION_FORMAT_1 ? serverParts(m, actions, problems, String(raw.format)) : { routes: [], jobs: [], events: [] };
  const third = raw.format === EXTENSION_FORMAT ? thirdParts(m, actions, problems) : { answers: [], uses: [] };
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
        ...server,
        ...third,
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
export function extensionAsks(manifest: ExtensionManifest): {
  collections: string[];
  secrets: string[];
  egress: string[];
  points: { action: string; on: ExtensionPoint }[];
  routes: string[];
  jobs: { action: string; everyMinutes: number }[];
  events: string[];
  /** The actions that see the site's pictures (ADR 0059 d3). */
  pictures: string[];
  /** The questions it answers, and the program's data it reads (ADR 0062). */
  answers: string[];
  uses: string[];
} {
  const label = (name: string): string => manifest.actions.find((a) => a.name === name)?.label ?? name;
  return {
    collections: manifest.collections.map((c) => c.label),
    secrets: manifest.collections.flatMap((c) => c.fields.filter((f) => f.kind === 'secret').map((f) => `${c.label}: ${f.label}`)),
    egress: manifest.egress,
    points: manifest.actions.flatMap((a) => (a.on ? [{ action: a.label, on: a.on }] : [])),
    routes: manifest.routes.map((r) => `/_/x/${manifest.name}/${r.path}`),
    jobs: manifest.jobs.map((j) => ({ action: label(j.action), everyMinutes: j.everyMinutes })),
    events: [...new Set(manifest.events.map((e) => e.on))],
    pictures: manifest.actions.filter((a) => a.pictures).map((a) => a.label),
    answers: manifest.answers.map((a) => a.question),
    uses: manifest.uses,
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
