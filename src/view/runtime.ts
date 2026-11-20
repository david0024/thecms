// SPDX-License-Identifier: MIT
/**
 * What every front end does the same way when it draws a `thecms.view/1`
 * screen (ADR 0031), so that a front end only draws: which fields, which rows
 * and in what order, which buttons for a row, what a button sends, and what
 * an action's answer asks of the screen.
 */
import type { Button, Condition, FieldRef, Literal, Tone, Value, View, ViewDocument } from './spec.ts';

export interface ShownField {
  key: string;
  /** The view's label, or none: the collection's own is used. */
  label?: string;
  display: 'text' | 'badge';
  tones: Record<string, Tone>;
}

/** How many of a collection's fields a list shows when the view names none. */
const DEFAULT_FIELDS = 6;

/** The fields a view shows: those it names, or the collection's first. */
export function shownFields(fields: FieldRef[] | undefined, declared: { key: string }[]): ShownField[] {
  const named = fields ?? declared.slice(0, DEFAULT_FIELDS).map((f) => f.key);
  return named.map((f) => (typeof f === 'string' ? { key: f, display: 'text', tones: {} } : { key: f.field, ...(f.label ? { label: f.label } : {}), display: f.display ?? 'text', tones: f.tones ?? {} }));
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** A value with its references filled from a row: unresolved (undefined) when there is no row to read. */
export function resolveValue(value: Value, row: Record<string, unknown> | null): unknown {
  if (value !== null && typeof value === 'object') {
    if ('$record' in value) return row ? (row[value.$record] ?? null) : undefined;
    return today();
  }
  return value;
}

/** A button's input, filled from the row it is on. */
export function resolveInput(input: Record<string, Value> | undefined, row: Record<string, unknown> | null): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input ?? {}).map(([key, value]) => [key, resolveValue(value, row)]));
}

const compare = (a: unknown, b: unknown): number => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true }));

/** Whether a row meets every condition. */
export function matches(row: Record<string, unknown>, conditions: Condition[] | undefined): boolean {
  return (conditions ?? []).every(({ field, op, value }) => {
    const have = row[field] ?? null;
    if (op === 'null') return have === null || have === '';
    if (op === 'not_null') return have !== null && have !== '';
    if (op === 'in' || op === 'not_in') return (value as Literal[]).some((v) => v === have) === (op === 'in');
    const want = resolveValue(value as Value, row);
    const order = compare(have, want);
    return { eq: have === want, neq: have !== want, lt: order < 0, lte: order <= 0, gt: order > 0, gte: order >= 0 }[op];
  });
}

/** A list's rows: those its filter keeps, in its order. */
export function listRows<T extends Record<string, unknown>>(rows: T[], filter: Condition[] | undefined, sort: string | undefined): T[] {
  const kept = rows.filter((row) => matches(row, filter));
  if (!sort) return kept;
  const [key, way] = sort.startsWith('-') ? [sort.slice(1), -1] : [sort, 1];
  return [...kept].sort((a, b) => way * compare(a[key], b[key]));
}

/** The buttons drawn for a row: those whose `when` it meets. */
export const buttonsFor = (buttons: Button[] | undefined, row: Record<string, unknown> | null): Button[] => (buttons ?? []).filter((b) => !b.when || (row !== null && matches(row, b.when)));

/** Every view in a screen, the tabs' too. */
export function allViews(views: readonly View[]): View[] {
  return views.flatMap((v) => (v.type === 'tabs' ? [v, ...allViews(v.views)] : [v]));
}

/** The screen that holds the view with this id, and the view. */
export function findView(docs: readonly ViewDocument[], id: string): { doc: ViewDocument; view: View } | null {
  for (const doc of docs) {
    const view = allViews([doc]).find((v) => v.id === id);
    if (view) return { doc, view };
  }
  return null;
}

/**
 * What the screens let a person do to a collection's rows directly. The
 * program allows these writes, and no others, through the rows of the data
 * API; everything else an extension does goes through its actions.
 */
export function rowWrites(docs: readonly ViewDocument[], collection: string): { read: boolean; create: boolean; edit: boolean; delete: boolean } {
  const views = allViews(docs).filter((v) => 'collection' in v && v.collection === collection);
  const any = (test: (v: View) => boolean): boolean => views.some(test);
  const single = (v: View): boolean => v.type === 'form' && 'singleton' in v;
  return {
    read: views.length > 0,
    create: any((v) => (v.type === 'list' && v.create !== false) || single(v)),
    edit: any((v) => (v.type === 'list' && v.edit !== false) || single(v)),
    delete: any((v) => v.type === 'list' && v.delete !== false),
  };
}

/** What an action's answer asks of the screen. */
export type ActionResult = { kind: 'reveal'; text: string } | { kind: 'navigate'; view: string } | { kind: 'values'; value: unknown };

/** An answer `{reveal}` is shown once (a key); `{view}` opens that view; anything else is values. */
export function readActionResult(value: unknown): ActionResult {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const v = value as Record<string, unknown>;
    if (keys.length === 1 && typeof v.reveal === 'string') return { kind: 'reveal', text: v.reveal };
    if (keys.length === 1 && typeof v.view === 'string') return { kind: 'navigate', view: v.view };
  }
  return { kind: 'values', value };
}
