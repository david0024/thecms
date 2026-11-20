// SPDX-License-Identifier: MIT
/**
 * `thecms.view/1`: how an extension describes its screens (ADR 0031), on the
 * model of Zveltio's `zveltio.view/2`.
 *
 * A view is semantic. It names the extension's collections, their fields and
 * its actions, never an address, an HTTP verb, a CSS class, an icon or an
 * expression. Every object is closed: a key the vocabulary does not have (a
 * `url`, an `endpoint`, a `class`) is refused, not ignored. Each front end
 * draws a view its own way; the admin in Svelte is the first.
 *
 * This module stands on its own: it imports nothing, so another front end, a
 * tool that writes views or the packer can take it as it is. Additions within
 * `thecms.view/1` are new optional keys or view kinds; removing or narrowing
 * anything is `thecms.view/2`.
 */

export const VIEW_SPEC = 'thecms.view/1';

/** The kinds of view. A kind is added within `thecms.view/1` only with a front end that draws it. */
export const VIEW_KINDS = ['list', 'form', 'tabs'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

/** How a value or a button is marked: what it means, never what it looks like. */
export const TONES = ['neutral', 'success', 'warning', 'danger', 'muted'] as const;
export type Tone = (typeof TONES)[number];

/** The operators of a condition. `in` and `not_in` take a list; `null` and `not_null` take nothing. */
export const OPERATORS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'not_in', 'null', 'not_null'] as const;
export type Operator = (typeof OPERATORS)[number];

/** A value given in a view: a literal, a field of the row the button is on, or today's date. */
export type Literal = string | number | boolean | null;
export type Value = Literal | { $record: string } | { $today: true };

export interface Condition {
  field: string;
  op: Operator;
  value?: Value | Literal[];
}

/** A field of the collection, by name; an object adds only how it is shown. */
export type FieldRef =
  | string
  | {
      field: string;
      label?: string;
      display?: 'text' | 'badge';
      /** For a badge: the tone of each value. */
      tones?: Record<string, Tone>;
    };

interface ButtonBase {
  label: string;
  tone?: Tone;
  /** Asked before the button does anything; the words are the extension's. */
  confirm?: string;
  /** Drawn only for a row that meets these. */
  when?: Condition[];
}
/** Runs one of the extension's actions. What its `input` leaves open and `prompt` names is asked first. */
export interface ActionButton extends ButtonBase {
  action: string;
  input?: Record<string, Value>;
  prompt?: string[];
}
/** Opens another of the extension's views, by its id. */
export interface NavigateButton extends ButtonBase {
  navigate: string;
}
export type Button = ActionButton | NavigateButton;

interface ViewBase {
  /** What `navigate` names. At the top of a document it is required. */
  id?: string;
  title?: string;
  /** Its toolbar. */
  actions?: Button[];
}

/** Rows of a collection, as a table. `create`, `edit` and `delete` offer the collection's own form. */
export interface ListView extends ViewBase {
  type: 'list';
  collection: string;
  /** Absent: the collection's first fields. */
  fields?: FieldRef[];
  filter?: Condition[];
  /** A field name, `-` before it for the largest first. */
  sort?: string;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  rowActions?: Button[];
}

/** One record to write: the collection's single row (settings), or an action's questions. */
export type FormView = ViewBase & { type: 'form'; fields?: FieldRef[] } & ({ collection: string; singleton: true } | { action: string; submit?: string });

/** Views side by side, one shown at a time. Each has a title. */
export interface TabsView extends ViewBase {
  type: 'tabs';
  views: View[];
}

export type View = ListView | FormView | TabsView;

/** A screen as the manifest lists it: a view with the spec, an id and a title. */
export type ViewDocument = View & { spec: typeof VIEW_SPEC; id: string; title: string };

/** What a view may name: the extension's own collections and actions. */
export interface ViewScope {
  collections: { name: string; fields: { key: string }[] }[];
  /** `on` set: the action runs in the editor, on a block or a page, and no screen runs it. */
  actions: { name: string; ask: { key: string }[]; on?: string | null }[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isLiteral = (v: unknown): v is Literal => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const ID = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/;

/** Checks views against the vocabulary and against what they name. */
class Checker {
  readonly problems: string[] = [];
  readonly ids = new Set<string>();
  readonly targets: { at: string; id: string }[] = [];
  constructor(readonly scope: ViewScope) {}

  say(at: string, problem: string): void {
    this.problems.push(`${at}: ${problem}`);
  }

  /** An action a screen may run: one of the extension's, and not one the editor runs. */
  action(at: string, name: unknown): ViewScope['actions'][number] | null {
    const action = this.scope.actions.find((a) => a.name === name);
    if (!action) this.say(at, `"${String(name)}" is not one of the extension's actions`);
    else if (action.on) this.say(at, `"${action.name}" runs in the editor, on a ${action.on}; a screen does not run it`);
    return action ?? null;
  }

  /** The object has only these keys, and has the required ones. */
  keys(at: string, raw: Record<string, unknown>, allowed: string[], required: string[] = []): void {
    for (const key of Object.keys(raw)) if (!allowed.includes(key)) this.say(at, `"${key}" is not part of ${VIEW_SPEC}`);
    for (const key of required) if (raw[key] === undefined) this.say(at, `"${key}" is required`);
  }

  text(at: string, value: unknown, key: string, required = false): void {
    if (value === undefined && !required) return;
    if (typeof value !== 'string' || !value.trim() || value.length > 200) this.say(at, `"${key}" is a short text`);
  }

  collection(at: string, name: unknown): { name: string; fields: { key: string }[] } | null {
    const found = this.scope.collections.find((c) => c.name === name);
    if (!found) this.say(at, `"${String(name)}" is not one of the extension's collections`);
    return found ?? null;
  }

  field(at: string, of: { name: string; fields: { key: string }[] } | null, name: unknown): void {
    if (typeof name !== 'string') return this.say(at, 'a field is named by its key');
    if (of && name !== 'id' && !of.fields.some((f) => f.key === name)) this.say(at, `"${of.name}" has no field "${name}"`);
  }

  value(at: string, raw: unknown, of: { name: string; fields: { key: string }[] } | null): void {
    if (isLiteral(raw)) return;
    if (isObject(raw) && Object.keys(raw).length === 1) {
      if ('$record' in raw) return of ? this.field(at, of, raw.$record) : this.say(at, '$record is only for a button on a row');
      if (raw.$today === true) return;
    }
    this.say(at, 'a value is a text, a number, true, false, null, {"$record": field} or {"$today": true}');
  }

  conditions(at: string, raw: unknown, of: { name: string; fields: { key: string }[] } | null): void {
    if (!Array.isArray(raw)) return this.say(at, 'conditions are a list');
    const pairs = new Set<string>();
    raw.forEach((c, i) => {
      const here = `${at}[${i}]`;
      if (!isObject(c)) return this.say(here, 'a condition is {field, op, value}');
      this.keys(here, c, ['field', 'op', 'value'], ['field', 'op']);
      this.field(here, of, c.field);
      const op = OPERATORS.find((o) => o === c.op);
      if (!op) return this.say(here, `"op" is one of ${OPERATORS.join(', ')}`);
      const pair = `${String(c.field)} ${op}`;
      if (pairs.has(pair)) this.say(here, `"${pair}" is given twice`);
      pairs.add(pair);
      if (op === 'null' || op === 'not_null') {
        if (c.value !== undefined) this.say(here, `"${op}" takes no value`);
      } else if (op === 'in' || op === 'not_in') {
        if (!Array.isArray(c.value) || !c.value.every(isLiteral)) this.say(here, `"${op}" takes a list of values`);
      } else this.value(here, c.value, of);
    });
  }

  fields(at: string, raw: unknown, of: { name: string; fields: { key: string }[] } | null): void {
    if (!Array.isArray(raw) || raw.length === 0) return this.say(at, 'fields are a list of at least one');
    raw.forEach((f, i) => {
      const here = `${at}[${i}]`;
      if (typeof f === 'string') return this.field(here, of, f);
      if (!isObject(f)) return this.say(here, 'a field is its key, or {field, label, display, tones}');
      this.keys(here, f, ['field', 'label', 'display', 'tones'], ['field']);
      this.field(here, of, f.field);
      this.text(here, f.label, 'label');
      if (f.display !== undefined && f.display !== 'text' && f.display !== 'badge') this.say(here, '"display" is text or badge');
      if (f.tones !== undefined) {
        if (!isObject(f.tones)) this.say(here, '"tones" names a tone for each value');
        else for (const tone of Object.values(f.tones)) if (!TONES.includes(tone as Tone)) this.say(here, `a tone is one of ${TONES.join(', ')}`);
      }
    });
  }

  buttons(at: string, raw: unknown, row: { name: string; fields: { key: string }[] } | null): void {
    if (!Array.isArray(raw)) return this.say(at, 'buttons are a list');
    raw.forEach((b, i) => {
      const here = `${at}[${i}]`;
      if (!isObject(b)) return this.say(here, 'a button is an object');
      const common = ['label', 'tone', 'confirm', 'when'];
      if ('navigate' in b) {
        this.keys(here, b, [...common, 'navigate'], ['label', 'navigate']);
        if (typeof b.navigate === 'string') this.targets.push({ at: here, id: b.navigate });
        else this.say(here, '"navigate" names a view by its id');
      } else {
        this.keys(here, b, [...common, 'action', 'input', 'prompt'], ['label', 'action']);
        const action = this.action(here, b.action);
        const input = b.input === undefined ? {} : b.input;
        if (!isObject(input)) this.say(here, '"input" gives a value for each key');
        else for (const [key, value] of Object.entries(input)) this.value(`${here}.input.${key}`, value, row);
        if (b.prompt !== undefined) {
          if (!Array.isArray(b.prompt)) this.say(here, '"prompt" lists what to ask');
          else
            for (const key of b.prompt) {
              if (isObject(input) && key in input) this.say(here, `"${String(key)}" is given in "input"; it is not asked`);
              else if (action && !action.ask.some((a) => a.key === key)) this.say(here, `"${action.name}" asks nothing called "${String(key)}"`);
            }
        }
      }
      this.text(here, b.label, 'label', true);
      this.text(here, b.confirm, 'confirm');
      if (b.tone !== undefined && !TONES.includes(b.tone as Tone)) this.say(here, `"tone" is one of ${TONES.join(', ')}`);
      if (b.when !== undefined) {
        if (!row) this.say(here, '"when" is only for a button on a row');
        this.conditions(`${here}.when`, b.when, row);
      }
    });
  }

  view(at: string, raw: unknown, top: boolean): void {
    if (!isObject(raw)) return this.say(at, 'a view is an object');
    const base = ['type', 'id', 'title', 'actions', ...(top ? ['spec'] : [])];
    if (raw.id !== undefined) {
      if (typeof raw.id !== 'string' || !ID.test(raw.id)) this.say(at, '"id" is lower case words joined by dots: "ai.providers"');
      else if (this.ids.has(raw.id)) this.say(at, `the id "${raw.id}" is used twice`);
      else this.ids.add(raw.id);
    } else if (top) this.say(at, '"id" is required');
    this.text(at, raw.title, 'title', top);
    switch (raw.type) {
      case 'list': {
        this.keys(at, raw, [...base, 'collection', 'fields', 'filter', 'sort', 'create', 'edit', 'delete', 'rowActions'], ['collection']);
        const of = this.collection(at, raw.collection);
        if (raw.fields !== undefined) this.fields(`${at}.fields`, raw.fields, of);
        if (raw.filter !== undefined) this.conditions(`${at}.filter`, raw.filter, of);
        if (raw.sort !== undefined) {
          if (typeof raw.sort !== 'string') this.say(at, '"sort" is a field, with - before it for the largest first');
          else this.field(`${at}.sort`, of, raw.sort.replace(/^-/, ''));
        }
        for (const key of ['create', 'edit', 'delete']) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') this.say(at, `"${key}" is true or false`);
        if (raw.rowActions !== undefined) this.buttons(`${at}.rowActions`, raw.rowActions, of);
        if (raw.actions !== undefined) this.buttons(`${at}.actions`, raw.actions, null);
        return;
      }
      case 'form': {
        if ('action' in raw) {
          this.keys(at, raw, [...base, 'action', 'submit', 'fields'], ['action']);
          const action = this.action(at, raw.action);
          if (raw.fields !== undefined) this.fields(`${at}.fields`, raw.fields, action ? { name: action.name, fields: action.ask } : null);
          this.text(at, raw.submit, 'submit');
        } else {
          this.keys(at, raw, [...base, 'collection', 'singleton', 'fields'], ['collection', 'singleton']);
          const of = this.collection(at, raw.collection);
          if (raw.singleton !== true) this.say(at, 'a form over a collection is its one row: "singleton": true');
          if (raw.fields !== undefined) this.fields(`${at}.fields`, raw.fields, of);
        }
        if (raw.actions !== undefined) this.buttons(`${at}.actions`, raw.actions, null);
        return;
      }
      case 'tabs': {
        this.keys(at, raw, [...base, 'views'], ['views']);
        if (!Array.isArray(raw.views) || raw.views.length < 2) return this.say(at, '"views" are two or more');
        raw.views.forEach((v, i) => {
          if (isObject(v) && v.title === undefined) this.say(`${at}.views[${i}]`, 'a tab has a title');
          this.view(`${at}.views[${i}]`, v, false);
        });
        if (raw.actions !== undefined) this.buttons(`${at}.actions`, raw.actions, null);
        return;
      }
      default:
        this.say(at, `"type" is one of ${VIEW_KINDS.join(', ')}`);
    }
  }
}

/**
 * Checks an extension's screens: each against the vocabulary, each name
 * against what the extension declares, and each `navigate` against the ids
 * the screens give. Every problem is said, with where it is.
 */
export function checkViews(raw: unknown, scope: ViewScope): { views: ViewDocument[]; problems: string[] } {
  const checker = new Checker(scope);
  if (raw === undefined) return { views: [], problems: [] };
  if (!Array.isArray(raw)) return { views: [], problems: ['views: a list of screens'] };
  if (raw.length > 24) checker.say('views', 'at most 24 screens');
  raw.slice(0, 24).forEach((doc, i) => {
    const at = `views[${i}]`;
    if (!isObject(doc) || doc.spec !== VIEW_SPEC) return checker.say(at, `a screen starts with "spec": "${VIEW_SPEC}"`);
    checker.view(at, doc, true);
  });
  for (const { at, id } of checker.targets) if (!checker.ids.has(id)) checker.say(at, `no view has the id "${id}"`);
  return { views: checker.problems.length ? [] : (raw as ViewDocument[]), problems: checker.problems };
}
