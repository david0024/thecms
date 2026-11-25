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
import { allViews, checkViews, type ViewDocument } from '../view/index.ts';
import { fromOldName } from './name.ts';
import { isObject, str } from './util.ts';

/**
 * The format a package is written in now: the third, with what a shop's
 * providers need (ADR 0076 d4): questions at checkout, actions on an order,
 * jobs queued once, files, collections that can be searched and numbers taken
 * only while enough is left.
 */
export const EXTENSION_FORMAT = 'uhlaka.extension/4';
/** The third format (ADR 0062), still read: what the program tells, asks and lends. */
export const EXTENSION_FORMAT_3 = 'uhlaka.extension/3';
/** The second format (ADR 0041), still read: routes, jobs and the events of the site's changes. */
export const EXTENSION_FORMAT_2 = 'uhlaka.extension/2';
/** The first format (ADR 0026), still read: a package in it has no routes, jobs or events. */
export const EXTENSION_FORMAT_1 = 'uhlaka.extension/1';
const FORMATS: readonly string[] = [EXTENSION_FORMAT, EXTENSION_FORMAT_3, EXTENSION_FORMAT_2, EXTENSION_FORMAT_1];
/** The number of a package's format: 1 to 4. */
const formatOf = (format: string): number => Number(format.slice(format.lastIndexOf('/') + 1));
export const EXTENSION_MAX_BYTES = 5 * 1024 * 1024;

const NAME = /^[a-z][a-z0-9-]{1,39}$/;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$|^127\.0\.0\.1$/;

export const FIELD_KINDS = ['text', 'longtext', 'number', 'boolean', 'choice', 'secret', 'url', 'date', 'datetime'] as const;
/** The kinds the third format adds (ADR 0062 d7): a day, `YYYY-MM-DD`, and a day and time, `YYYY-MM-DDTHH:MM`. */
const KINDS_3: readonly string[] = ['date', 'datetime'];
/** The kinds of screen the third format adds (ADR 0062 d7). */
const VIEWS_3: readonly string[] = ['report', 'calendar'];
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
  /**
   * No two rows have the same value here (ADR 0076 d4.5), kept by the program
   * in the step that writes the row: a provider's payment, a number in a series.
   * An empty value is not counted.
   */
  unique: boolean;
}

export interface ExtensionCollection {
  name: string;
  label: string;
  fields: ExtensionField[];
}

/**
 * Where an action shows in the editor: on the block being edited, or on the
 * whole page. Its answer is put in the editor as a change the person sees and
 * saves, never written behind their back. Or, in the fourth format, on an
 * order in the Orders screen (ADR 0076 d4.2): an AWB, an invoice, a refund.
 */
export const EXTENSION_POINTS = ['block', 'page', 'order'] as const;
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
  /** It keeps files (ADR 0076 d4.4): an invoice's PDF, a label, put on an order. */
  files: boolean;
  timeoutSeconds: number;
}

/**
 * The program's data an extension may read, declared (ADR 0062 d4): the
 * published pages, with visitor accounts (ADR 0064 d7) the members and
 * e-mail to them, and with the shop (ADR 0065 d9) its orders.
 */
export const PROGRAM_DATA = ['published', 'members', 'mail', 'orders'] as const;
export type ProgramData = (typeof PROGRAM_DATA)[number];

/** The questions the program asks an extension and waits for (ADR 0062 d3), and what each may answer. */
export const QUESTIONS = { 'comment.check': ['hold', 'approve', 'spam'] } as const;
export type Question = keyof typeof QUESTIONS;
/** How long the program waits for an answer before it goes on without it. */
export const ANSWER_SECONDS = 10;

/**
 * The questions a shop asks at checkout (ADR 0076 d4.1), in the fourth
 * format. `checkout.payment`: where the buyer is sent to pay with one of the
 * methods the extension declares. `checkout.delivery`: the ways a cart can be
 * delivered, and their prices.
 */
export const CHECKOUT_QUESTIONS = ['checkout.payment', 'checkout.delivery'] as const;
export type CheckoutQuestion = (typeof CHECKOUT_QUESTIONS)[number];

/** A way to pay an extension offers at checkout: `card`, with the words the buyer reads. */
export interface PaymentMethod {
  id: string;
  label: string;
}

export interface ExtensionAnswer {
  question: Question | CheckoutQuestion;
  action: string;
  /** For `checkout.payment`, the ways to pay it offers. */
  methods: PaymentMethod[];
}

/** The kinds of field a public block asks for (ADR 0062 d6): those of the form builder, and a consent to tick. */
export const BLOCK_FIELD_KINDS = ['text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'consent'] as const;
export type BlockFieldKind = (typeof BLOCK_FIELD_KINDS)[number];
/** The names the block's form itself sends, which no field may take. */
export const BLOCK_RESERVED: readonly string[] = ['back', 'block', 'form', 'website'];

export interface PublicBlockField {
  key: string;
  label: string;
  kind: BlockFieldKind;
  required: boolean;
  /** For a choice, what it may be. */
  options: string[];
}

/**
 * A block the author places on a page (ADR 0062 d6): a form, drawn by the
 * site with its theme and no script, posted to one of the extension's routes.
 */
export interface PublicBlock {
  name: string;
  label: string;
  fields: PublicBlockField[];
  /** The button's words. */
  submit: string;
  /** What the page says once it was sent; the site's own words when empty. */
  sent: string;
  /** The route it is posted to, one that takes POST. */
  route: string;
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

/**
 * Work queued once, by `host.later` (ADR 0076 d4.3): kept in the database,
 * run when due, tried again with a growing wait, and said in the log when it
 * gives up. Declared as a job with `"once": true`.
 */
export const LATER_TRIES = 8;

/** What happens in the site that an extension may hear of, and what it is told. */
export const EXTENSION_EVENTS = [
  'page.published',
  'entry.published',
  'comment.created',
  'comment.approved',
  'message.received',
  'page.served',
  'search.made',
  'account.made',
  'account.removed',
  'member.changed',
  'order.made',
  'order.paid',
  'order.sent',
  'order.refunded',
] as const;
/** What visitor accounts tell (ADR 0064 d7): the visitor's id and levels, never their e-mail, password or session. */
export const ACCOUNT_EVENTS: readonly ExtensionEventName[] = ['account.made', 'account.removed', 'member.changed'];
/** What the shop tells (ADR 0065 d9): the order's id, number, total and currency, never who bought it. */
export const ORDER_EVENTS: readonly ExtensionEventName[] = ['order.made', 'order.paid', 'order.sent', 'order.refunded'];
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

/**
 * A message an extension sends a visitor (ADR 0064 d7), with `{name}`,
 * `{site}` and `{link}`; its words are translated by the extension's
 * `messages`, as its other words are.
 */
export interface ExtensionMail {
  name: string;
  subject: string;
  text: string;
}
/** Of the site's own messages, the one an extension may send: the others carry links only the program makes. */
export const SITE_MAILS_LENT: readonly string[] = ['welcome'];

export interface ExtensionManifest {
  name: string;
  displayName: string;
  description: string;
  version: string;
  publisher: string;
  /** The first version of this program it works with. */
  uhlakaMinVersion: string;
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
  /** The actions `host.later` may queue (ADR 0076 d4.3). */
  later: string[];
  events: ExtensionListener[];
  /** The questions it answers, and the program's data it reads (ADR 0062). */
  answers: ExtensionAnswer[];
  uses: ProgramData[];
  /** The blocks it adds to the public site (ADR 0062 d6). */
  blocks: PublicBlock[];
  /** The messages it sends visitors, with `uses: ["mail"]` (ADR 0064 d7). */
  mails: ExtensionMail[];
}

export interface ExtensionPackage {
  manifest: ExtensionManifest;
  /** The actions, as one ES module: `export const actions = { name: async (input, host) => … }`. */
  code: string;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown, max: number): string => str(value, max).trim();

/** The kinds a field declared unique may be (ADR 0076 d4.5). */
const UNIQUE_KINDS: readonly string[] = ['text', 'number', 'url'];

function field(raw: unknown, problems: string[], where: string, format: number): ExtensionField | null {
  const third = format >= 3;
  if (!isObject(raw)) return null;
  const key = text(raw.key, 40);
  if (!KEY.test(key)) {
    problems.push(`${where}: a field's key is lower case letters, digits and _ ("${key}")`);
    return null;
  }
  const kinds = third ? FIELD_KINDS : FIELD_KINDS.filter((k) => !KINDS_3.includes(k));
  const kind = kinds.find((k) => k === raw.kind);
  if (!kind) {
    problems.push(`${where}.${key}: a field is one of ${kinds.join(', ')}`);
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
          : kind === 'secret' || KINDS_3.includes(kind)
            ? null
            : text(initial, 2000);
  const unique = raw.unique === true && format >= 4 && UNIQUE_KINDS.includes(kind);
  if (raw.unique === true && !unique) problems.push(format >= 4 ? `${where}.${key}: only a field of ${UNIQUE_KINDS.join(', ')} is unique` : `${where}.${key}: a unique field needs ${EXTENSION_FORMAT}`);
  return { key, label: text(raw.label, 80) || key, kind, required: raw.required === true, options, initial: fit, unique };
}

function collection(raw: unknown, problems: string[], format: number): ExtensionCollection | null {
  if (!isObject(raw)) return null;
  const name = text(raw.name, 40);
  if (!KEY.test(name)) {
    problems.push(`a collection's name is lower case letters, digits and _ ("${name}")`);
    return null;
  }
  const fields: ExtensionField[] = [];
  for (const f of list(raw.fields).slice(0, 40)) {
    const one = field(f, problems, name, format);
    if (!one) continue;
    if (one.key === 'id' || fields.some((x) => x.key === one.key)) problems.push(`${name}.${one.key}: a field's key is used once, and never "id"`);
    else fields.push(one);
  }
  if (fields.length === 0) problems.push(`${name}: a collection has at least one field`);
  return { name, label: text(raw.label, 80) || name, fields };
}

function action(raw: unknown, names: string[], problems: string[], format: number): ExtensionAction | null {
  if (!isObject(raw)) return null;
  const name = text(raw.name, 40);
  if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(name)) {
    problems.push(`an action's name is letters and digits ("${name}")`);
    return null;
  }
  const points = format >= 4 ? EXTENSION_POINTS : EXTENSION_POINTS.filter((p) => p !== 'order');
  const on = points.find((p) => p === raw.on) ?? null;
  if (raw.on !== undefined && raw.on !== null && !on) problems.push(`${name}: an action is on ${points.join(' or ')}, or on its own screen`);
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
  const uses = PROGRAM_DATA.filter((d) => list(raw.uses).includes(d));
  // An action on an order reads it: the order is the program's, lent by `orders` (ADR 0065 d9).
  if (on === 'order' && !uses.includes('orders')) problems.push(`${name}: an action on an order declares that it uses "orders"`);
  if (raw.files === true && format < 4) problems.push(`${name}: keeping files needs ${EXTENSION_FORMAT}`);
  return {
    name,
    label: text(raw.label, 60) || name,
    on,
    ask,
    each,
    reads: own(raw.reads, 'reads'),
    writes: own(raw.writes, 'writes'),
    pictures: raw.pictures === true,
    uses,
    files: raw.files === true && format >= 4,
    timeoutSeconds: Number.isInteger(seconds) && seconds >= 1 && seconds <= 300 ? seconds : 60,
  };
}

const ROUTE = /^[a-z0-9][a-z0-9-]{0,39}(\/[a-z0-9][a-z0-9-]{0,39}){0,3}$/;

/**
 * Routes, jobs and events each name an action that runs on its own, not one
 * the editor offers on a block or a page: what it is given is not a page.
 */
function serverParts(m: Record<string, unknown>, actions: ExtensionAction[], problems: string[], format: number): Pick<ExtensionManifest, 'routes' | 'jobs' | 'later' | 'events'> {
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
  const later: string[] = [];
  for (const j of list(m.jobs).slice(0, 12)) {
    if (!isObject(j)) continue;
    const every = Number(j.everyMinutes);
    const action = own(j.action, 'a job');
    if (j.once === true) {
      // Queued by `host.later` (ADR 0076 d4.3), not run at an interval.
      if (format < 4) problems.push(`a job queued once needs ${EXTENSION_FORMAT}`);
      else if (action && later.includes(action)) problems.push(`the job "${action}" is declared twice`);
      else if (action) later.push(action);
      continue;
    }
    if (!Number.isInteger(every) || every < 1 || every > 10_080) problems.push(`a job runs every 1 to 10080 minutes ("${String(j.everyMinutes)}")`);
    else if (action && jobs.some((x) => x.action === action)) problems.push(`the job "${action}" is declared twice`);
    else if (action) jobs.push({ action, everyMinutes: every });
  }
  const events: ExtensionListener[] = [];
  for (const e of list(m.events).slice(0, 24)) {
    if (!isObject(e)) continue;
    const heard = format >= 3 ? EXTENSION_EVENTS : EVENTS_2;
    const on = EXTENSION_EVENTS.find((x) => x === e.on && heard.includes(x));
    if (!on) {
      problems.push(`an extension listens to one of ${heard.join(', ')} ("${text(e.on, 40)}")`);
      continue;
    }
    const action = own(e.action, `listening to ${on}`);
    if (action && !events.some((x) => x.on === on && x.action === action)) events.push({ on, action });
  }
  return { routes, jobs, later, events };
}

/** A public block's field (ADR 0062 d6). */
function blockField(raw: unknown, problems: string[], where: string): PublicBlockField | null {
  if (!isObject(raw)) return null;
  const key = text(raw.key, 40);
  if (!KEY.test(key) || BLOCK_RESERVED.includes(key)) {
    problems.push(`${where}: a field's key is lower case letters, digits and _, and not ${BLOCK_RESERVED.join(', ')} ("${key}")`);
    return null;
  }
  const kind = BLOCK_FIELD_KINDS.find((k) => k === raw.kind);
  if (!kind) {
    problems.push(`${where}.${key}: a block's field is one of ${BLOCK_FIELD_KINDS.join(', ')}`);
    return null;
  }
  const options = kind === 'select' ? [...new Set(list(raw.options).map((o) => text(o, 120)).filter(Boolean))].slice(0, 30) : [];
  if (kind === 'select' && options.length === 0) problems.push(`${where}.${key}: a choice needs its options`);
  return { key, label: text(raw.label, 400) || key, kind, required: kind === 'consent' || raw.required === true, options };
}

/** The blocks an extension adds to the public site (ADR 0062 d6), each posted to one of its routes that takes POST. */
function publicBlocks(m: Record<string, unknown>, routes: ExtensionRoute[], problems: string[]): PublicBlock[] {
  const blocks: PublicBlock[] = [];
  for (const b of list(m.blocks).slice(0, 12)) {
    if (!isObject(b)) continue;
    const name = text(b.name, 40);
    if (!NAME.test(name)) {
      problems.push(`a block's name is lower case letters, digits and - ("${name}")`);
      continue;
    }
    if (blocks.some((x) => x.name === name)) {
      problems.push(`the block "${name}" is declared twice`);
      continue;
    }
    const fields: PublicBlockField[] = [];
    for (const f of list(b.fields).slice(0, 20)) {
      const one = blockField(f, problems, name);
      if (!one) continue;
      if (fields.some((x) => x.key === one.key)) problems.push(`${name}.${one.key}: a field's key is used once`);
      else fields.push(one);
    }
    const path = text(b.route, 200).replace(/^\/+|\/+$/g, '');
    const route = routes.find((r) => r.path === path);
    if (!route) problems.push(`the block "${name}" is sent to "${path}", which is not one of its routes`);
    else if (!route.methods.includes('POST')) problems.push(`the block "${name}" is sent to "${path}", which does not take POST`);
    if (route?.methods.includes('POST')) blocks.push({ name, label: text(b.label, 60) || name, fields, submit: text(b.submit, 60) || 'Send', sent: text(b.sent, 400), route: path });
  }
  return blocks;
}

/** What the third format adds (ADR 0062): the questions it answers and the program's data it reads. */
function thirdParts(m: Record<string, unknown>, actions: ExtensionAction[], problems: string[], format: number): Pick<ExtensionManifest, 'answers' | 'uses' | 'mails'> {
  const uses = PROGRAM_DATA.filter((d) => list(m.uses).includes(d));
  for (const u of list(m.uses)) if (!PROGRAM_DATA.includes(u as ProgramData)) problems.push(`an extension reads ${PROGRAM_DATA.join(', ')} of the program's data ("${text(u, 40)}")`);
  for (const a of actions) for (const u of a.uses) if (!uses.includes(u)) problems.push(`${a.name}: it reads "${u}", which the extension does not declare in "uses"`);
  const answers: ExtensionAnswer[] = [];
  const asked: string[] = [...Object.keys(QUESTIONS), ...(format >= 4 ? CHECKOUT_QUESTIONS : [])];
  for (const q of list(m.answers).slice(0, 12)) {
    if (!isObject(q)) continue;
    const question = asked.find((x) => x === q.question) as ExtensionAnswer['question'] | undefined;
    if (!question) {
      problems.push(`an extension answers one of ${asked.join(', ')} ("${text(q.question, 40)}")`);
      continue;
    }
    // The ways to pay, each with the words the buyer reads (ADR 0076 d4.1).
    const methods: PaymentMethod[] = [];
    if (question === 'checkout.payment') {
      for (const raw of list(q.methods).slice(0, 6)) {
        if (!isObject(raw)) continue;
        const id = text(raw.id, 40);
        if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) problems.push(`a way to pay is named by lower case letters, digits and - ("${id}")`);
        else if (methods.some((x) => x.id === id)) problems.push(`the way to pay "${id}" is declared twice`);
        else methods.push({ id, label: text(raw.label, 60) || id });
      }
      if (!methods.length) problems.push('answering checkout.payment, it declares the ways to pay it offers in "methods"');
    }
    const action = actions.find((a) => a.name === text(q.action, 40));
    if (!action) problems.push(`answering ${question} runs "${text(q.action, 40)}", which is not one of its actions`);
    else if (action.on) problems.push(`answering ${question} runs "${action.name}", which the editor offers on a ${action.on}`);
    else if (answers.some((x) => x.question === question)) problems.push(`it answers ${question} twice`);
    else answers.push({ question, action: action.name, methods });
  }
  const mails: ExtensionMail[] = [];
  for (const raw of list(m.mails).slice(0, 12)) {
    if (!isObject(raw)) continue;
    const name = text(raw.name, 40);
    const subject = text(raw.subject, 200).replace(/[\r\n]+/g, ' ');
    const body = typeof raw.text === 'string' ? raw.text.slice(0, 5000) : '';
    if (!NAME.test(name)) problems.push(`a message's name is lower case letters, digits and - ("${name}")`);
    else if (SITE_MAILS_LENT.includes(name) || mails.some((x) => x.name === name)) problems.push(`the message "${name}" is declared twice, or is one of the site's`);
    else if (!subject || !body.trim()) problems.push(`the message "${name}" has a subject and a text`);
    else mails.push({ name, subject, text: body });
  }
  if (mails.length && !uses.includes('mail')) problems.push('it declares messages to visitors, and does not declare "mail" in "uses"');
  return { answers, uses, mails };
}

/** Reads a package, with every reason it cannot be installed. */
export function parseExtension(given: unknown): { pkg: ExtensionPackage | null; problems: string[] } {
  const problems: string[] = [];
  // A package made before the rename is read as it would be written now (ADR 0066).
  const raw = fromOldName(given);
  if (!isObject(raw) || typeof raw.format !== 'string' || !FORMATS.includes(raw.format)) return { pkg: null, problems: [`this is not an extension (${EXTENSION_FORMAT})`] };
  const m = isObject(raw.manifest) ? raw.manifest : {};
  const format = formatOf(raw.format);
  const name = text(m.name, 40);
  if (!NAME.test(name)) problems.push(`an extension's name is lower case letters, digits and - ("${name}")`);
  const version = text(m.version, 40);
  if (!VERSION.test(version)) problems.push(`its version is like 1.0.0 ("${version}")`);
  const min = text(m.uhlakaMinVersion, 40) || '0.0.0';
  if (!VERSION.test(min)) problems.push(`uhlakaMinVersion is like 0.1.0 ("${min}")`);
  const egress = [...new Set(list(m.egress).map((h) => text(h, 253).toLowerCase()))].slice(0, 10);
  for (const host of egress) if (!HOST.test(host)) problems.push(`"${host}" is not a host name it may call`);

  const collections: ExtensionCollection[] = [];
  for (const c of list(m.collections).slice(0, 12)) {
    const one = collection(c, problems, format);
    if (!one) continue;
    if (collections.some((x) => x.name === one.name)) problems.push(`the collection "${one.name}" is declared twice`);
    else collections.push(one);
  }
  const names = collections.map((c) => c.name);
  const actions: ExtensionAction[] = [];
  for (const a of list(m.actions).slice(0, 24)) {
    const one = action(a, names, problems, format);
    if (!one) continue;
    if (actions.some((x) => x.name === one.name)) problems.push(`the action "${one.name}" is declared twice`);
    else actions.push(one);
  }
  // Screens are checked against uhlaka.view/1 and against what this manifest declares.
  const { views, problems: viewProblems } = checkViews(m.views, { collections: collections.map((c) => ({ name: c.name, fields: c.fields })), actions });
  problems.push(...viewProblems);
  if (format < 3) for (const v of allViews(views)) if (VIEWS_3.includes(v.type)) problems.push(`a screen of the kind "${v.type}" needs ${EXTENSION_FORMAT_3}`);
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
  const server = format >= 2 ? serverParts(m, actions, problems, format) : { routes: [], jobs: [], later: [], events: [] };
  const third = format >= 3 ? { ...thirdParts(m, actions, problems, format), blocks: publicBlocks(m, server.routes, problems) } : { answers: [], uses: [], blocks: [], mails: [] };
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
        uhlakaMinVersion: min,
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
  /** The blocks it adds to the public site (ADR 0062 d6). */
  blocks: string[];
  /** The messages it sends visitors (ADR 0064 d7), by their subject. */
  mails: string[];
  /** Whether it works with visitor accounts (ADR 0064 d7): their events, the members or e-mail to them. */
  accounts: boolean;
  /** Whether it works with the shop (ADR 0065 d9): the orders' events, or the orders. */
  shop: boolean;
  /** The actions it may queue to run once, later (ADR 0076 d4.3). */
  later: string[];
  /** The actions that keep files (ADR 0076 d4.4). */
  files: string[];
  /** The ways to pay it offers at checkout, and whether it offers ways to deliver (ADR 0076 d4.1). */
  payments: string[];
  delivery: boolean;
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
    blocks: manifest.blocks.map((b) => b.label),
    mails: manifest.mails.map((m) => m.subject),
    accounts: manifest.uses.includes('members') || manifest.uses.includes('mail') || manifest.events.some((e) => ACCOUNT_EVENTS.includes(e.on)),
    shop:
      manifest.uses.includes('orders') ||
      manifest.events.some((e) => ORDER_EVENTS.includes(e.on)) ||
      manifest.answers.some((a) => (CHECKOUT_QUESTIONS as readonly string[]).includes(a.question)) ||
      manifest.actions.some((a) => a.on === 'order'),
    later: manifest.later.map(label),
    files: manifest.actions.filter((a) => a.files).map((a) => a.label),
    payments: manifest.answers.flatMap((a) => a.methods.map((m) => m.label)),
    delivery: manifest.answers.some((a) => a.question === 'checkout.delivery'),
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
      case 'date':
      case 'datetime': {
        // A day, or a day and a time as the browser's field gives it; nothing else.
        const at = text(given, 30);
        const fits = f.kind === 'date' ? /^\d{4}-\d{2}-\d{2}$/.test(at) : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at);
        value = at === '' ? null : fits && !Number.isNaN(Date.parse(f.kind === 'date' ? at : `${at}:00Z`)) ? at : null;
        if (at !== '' && value === null) problems.push(f.kind === 'date' ? `${f.label}: a day is like 2026-11-22` : `${f.label}: a day and time is like 2026-11-22T14:30`);
        break;
      }
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

/** How long each kind of a block's answer may be (ADR 0062 d6), as the form builder's (ADR 0049). */
const BLOCK_ANSWER_MAX: Record<BlockFieldKind, number> = { text: 200, textarea: 5000, email: 254, phone: 40, number: 30, date: 10, select: 120, consent: 3 };

/**
 * What a visitor sent with an extension's block (ADR 0062 d6), checked field
 * by field as the block declares them: what the extension's action is given.
 * A consent is true or the block was not sent; a number is a number; a field
 * left empty is null.
 */
export function cleanBlockPost(block: PublicBlock, sent: URLSearchParams): { fields: Record<string, string | number | boolean | null>; problems: string[] } {
  const fields: Record<string, string | number | boolean | null> = {};
  const problems: string[] = [];
  for (const f of block.fields) {
    const given = (sent.get(f.key) ?? '').trim();
    if (given.length > BLOCK_ANSWER_MAX[f.kind]) problems.push(`${f.key}: too long`);
    let value: string | number | boolean | null = given === '' ? null : given;
    if (value !== null)
      switch (f.kind) {
        case 'email':
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(given)) problems.push(`${f.key}: not an e-mail address`);
          break;
        case 'number':
          value = Number(given);
          if (!Number.isFinite(value)) problems.push(`${f.key}: not a number`);
          break;
        case 'date':
          if (!/^\d{4}-\d{2}-\d{2}$/.test(given) || Number.isNaN(Date.parse(given))) problems.push(`${f.key}: not a date`);
          break;
        case 'select':
          if (!f.options.includes(given)) problems.push(`${f.key}: not one of its options`);
          break;
        case 'consent':
          value = given === 'yes';
          break;
        case 'text':
        case 'phone':
          value = given.replace(/\s*\n\s*/g, ' ');
          break;
      }
    if (f.kind === 'consent' && value !== true) value = false;
    if (f.required && (value === null || value === false)) problems.push(`${f.key}: needed`);
    fields[f.key] = value;
  }
  return { fields, problems };
}

/** The fields of a collection no two rows share (ADR 0076 d4.5). */
export const uniqueFields = (of: ExtensionCollection): string[] => of.fields.filter((f) => f.unique).map((f) => f.key);

/** What one field is compared with in a search (ADR 0076 d4.5): equal to a value, or one of these. */
export type FindTest = string | number | boolean | null | { ne?: unknown; gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown; in?: unknown[]; has?: string };

/** A search of a collection, cleaned: the program writes every query, so only these. */
export interface FindQuery {
  where: Record<string, FindTest>;
  /** A field, or `-field` for the largest first; `id` is the order rows were made in. */
  order: string;
  limit: number;
  offset: number;
}

/** At most this many rows come back from one search. */
export const FIND_MAX = 500;
const FIND_OPS = ['ne', 'gt', 'gte', 'lt', 'lte', 'in', 'has'];

/**
 * Reads what an extension asked to search for (ADR 0076 d4.5), against the
 * collection's fields: a field it does not have, or a test that is not one of
 * those above, is refused, not ignored.
 */
export function cleanFind(of: ExtensionCollection, raw: unknown): { query: FindQuery; problems: string[] } {
  const given = isObject(raw) ? raw : {};
  const problems: string[] = [];
  const keys = ['id', ...of.fields.map((f) => f.key)];
  const where: Record<string, FindTest> = {};
  if (given.where !== undefined && !isObject(given.where)) problems.push('"where" is an object of fields');
  for (const [key, test] of Object.entries(isObject(given.where) ? given.where : {}).slice(0, 12)) {
    if (!keys.includes(key)) {
      problems.push(`${of.name} has no field "${key.slice(0, 40)}"`);
      continue;
    }
    if (isObject(test)) {
      const bad = Object.keys(test).find((op) => !FIND_OPS.includes(op));
      if (bad) problems.push(`${key}: a test is one of ${FIND_OPS.join(', ')} ("${bad.slice(0, 20)}")`);
      else if (test.in !== undefined && !Array.isArray(test.in)) problems.push(`${key}: "in" is a list`);
      else if (test.has !== undefined && typeof test.has !== 'string') problems.push(`${key}: "has" is a text`);
      else where[key] = { ...(test as object), ...(Array.isArray(test.in) ? { in: test.in.slice(0, 200) } : {}) };
    } else if (test === null || ['string', 'number', 'boolean'].includes(typeof test)) where[key] = test as FindTest;
    else problems.push(`${key}: a value, or a test`);
  }
  const order = typeof given.order === 'string' ? given.order : 'id';
  if (!keys.includes(order.replace(/^-/, ''))) problems.push(`${of.name} has no field "${order.slice(0, 40)}" to order by`);
  const limit = given.limit === undefined ? 100 : Number(given.limit);
  const offset = given.offset === undefined ? 0 : Number(given.offset);
  if (!Number.isInteger(limit) || limit < 0 || limit > FIND_MAX) problems.push(`"limit" is 0 to ${FIND_MAX}`);
  if (!Number.isInteger(offset) || offset < 0) problems.push('"offset" is 0 or more');
  return { query: { where, order, limit: Number.isInteger(limit) ? Math.min(Math.max(limit, 0), FIND_MAX) : 100, offset: Number.isInteger(offset) ? Math.max(offset, 0) : 0 }, problems };
}

/** Whether one value passes a test. Numbers compare as numbers, the rest as text. */
function passes(value: unknown, test: FindTest): boolean {
  if (!isObject(test)) return value === test || (value === undefined && test === null);
  const compare = (other: unknown): number => {
    if (typeof value === 'number' && typeof other === 'number') return value - other;
    return String(value ?? '').localeCompare(String(other ?? ''));
  };
  const has = (v: unknown): boolean => v !== null && v !== undefined && v !== '';
  if ('ne' in test && (value === test.ne || (value === undefined && test.ne === null))) return false;
  if ('gt' in test && !(has(value) && compare(test.gt) > 0)) return false;
  if ('gte' in test && !(has(value) && compare(test.gte) >= 0)) return false;
  if ('lt' in test && !(has(value) && compare(test.lt) < 0)) return false;
  if ('lte' in test && !(has(value) && compare(test.lte) <= 0)) return false;
  if (Array.isArray(test.in) && !test.in.includes(value)) return false;
  if (typeof test.has === 'string' && !String(value ?? '').toLowerCase().includes(test.has.toLowerCase())) return false;
  return true;
}

/** The rows a search finds, in its order, and how many there are in all. */
export function findRows<T extends Record<string, unknown>>(rows: readonly T[], query: FindQuery): { rows: T[]; count: number } {
  const found = rows.filter((row) => Object.entries(query.where).every(([key, test]) => passes(row[key], test)));
  const key = query.order.replace(/^-/, '');
  const down = query.order.startsWith('-') ? -1 : 1;
  const sorted = [...found].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    // Empty values go last, whichever way.
    if ((x === null || x === undefined || x === '') !== (y === null || y === undefined || y === '')) return x === null || x === undefined || x === '' ? 1 : -1;
    const by = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
    return by * down || String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
  return { rows: sorted.slice(query.offset, query.offset + query.limit), count: found.length };
}
