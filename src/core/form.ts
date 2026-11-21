/**
 * Forms (ADR 0049): built on a screen of their own, kept by the site, and
 * shown on pages by the "Form" block, which names one. A form has its fields
 * in order, the consent every visitor ticks, and the words around them, in
 * the main language and translated by field into the others.
 *
 * What a visitor sends is checked here, field by field as the form says, so
 * the server and the tests read the same rules.
 */
import type { Block } from './blocks.ts';
import { isObject, slugify, str } from './util.ts';

export type FormFieldKind = 'text' | 'textarea' | 'email' | 'phone' | 'number' | 'date' | 'select' | 'radio' | 'checkboxes';
export const FORM_FIELD_KINDS: readonly FormFieldKind[] = ['text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'radio', 'checkboxes'];
/** The kinds a visitor answers by choosing among the owner's options. */
export const CHOICE_KINDS: readonly FormFieldKind[] = ['select', 'radio', 'checkboxes'];

export interface FormField {
  /** The name it is sent under: kept when the label changes, so what was sent stays readable. */
  id: string;
  kind: FormFieldKind;
  label: string;
  required: boolean;
  /** The options of a choice, in the main language; empty for the other kinds. */
  options: string[];
}

/** A form's words in another language: each a value over the main language's, which shows where one is missing. */
export interface FormTranslation {
  consent?: string;
  button?: string;
  sent?: string;
  failed?: string;
  /** Each field's label, by the field's id. */
  labels?: Record<string, string>;
  /** Each choice's options, by the field's id, in the same order as the main language's. */
  options?: Record<string, string[]>;
}

export interface Form {
  /** `contact`, `quote`: what the block and the messages name it by. */
  name: string;
  /** What the admin calls it. */
  title: string;
  fields: FormField[];
  /** What the visitor agrees to, ticked before anything is sent (ADR 0019 d2). */
  consent: string;
  button: string;
  /** What the page says when it was sent, and when it was not. */
  sent: string;
  failed: string;
  translations: Record<string, FormTranslation>;
}

export const MAX_FORMS = 50;
export const MAX_FORM_FIELDS = 30;
export const MAX_OPTIONS = 30;
/** How long each kind's answer may be. */
export const ANSWER_MAX: Record<FormFieldKind, number> = { text: 200, textarea: 5000, email: 254, phone: 40, number: 30, date: 10, select: 120, radio: 120, checkboxes: 2000 };
/** The names the form itself sends, which no field may take. */
const RESERVED = new Set(['back', 'form', 'website', 'consent']);
const FIELD_ID = /^[a-z][a-z0-9-]{0,39}$/;

/** The words the ready forms are made with, in the site's language. */
export interface FormWords {
  formName: string;
  formEmail: string;
  formMessage: string;
  formConsent: string;
  formSend: string;
  formSent: string;
  formFailed: string;
  formTitle: string;
}

/** The form a site starts with: a name, an address to answer, and the message (ADR 0019). */
export function contactForm(words: FormWords): Form {
  return {
    name: 'contact',
    title: words.formTitle,
    fields: [
      { id: 'name', kind: 'text', label: words.formName, required: true, options: [] },
      { id: 'email', kind: 'email', label: words.formEmail, required: true, options: [] },
      { id: 'message', kind: 'textarea', label: words.formMessage, required: true, options: [] },
    ],
    consent: words.formConsent,
    button: words.formSend,
    sent: words.formSent,
    failed: words.formFailed,
    translations: {},
  };
}

/** A form with nothing in it yet but the consent and the words around it. */
export function emptyForm(words: FormWords, name: string, title: string): Form {
  return { ...contactForm(words), name, title, fields: [] };
}

/** The name the next field of this form takes: `f1`, `f2`, … never one it has. */
export function nextFieldId(form: Pick<Form, 'fields'>): string {
  const taken = new Set(form.fields.map((f) => f.id));
  let n = 1;
  while (taken.has(`f${n}`)) n++;
  return `f${n}`;
}

const words = (value: unknown, max: number): string => str(value, max).trim();
const optionsOf = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.map((o) => words(o, 120)).filter(Boolean))].slice(0, MAX_OPTIONS) : [];

function cleanField(raw: unknown, taken: Set<string>): FormField | null {
  if (!isObject(raw)) return null;
  const kind = FORM_FIELD_KINDS.includes(raw.kind as FormFieldKind) ? (raw.kind as FormFieldKind) : 'text';
  const label = words(raw.label, 200);
  let id = str(raw.id, 40).toLowerCase();
  if (!FIELD_ID.test(id) || RESERVED.has(id) || taken.has(id)) id = nextFieldId({ fields: [...taken].map((one) => ({ id: one }) as FormField) });
  const options = CHOICE_KINDS.includes(kind) ? optionsOf(raw.options) : [];
  // A choice with nothing to choose cannot be answered; it is left out, not kept broken.
  if (!label || (CHOICE_KINDS.includes(kind) && options.length === 0)) return null;
  taken.add(id);
  return { id, kind, label, required: raw.required === true, options };
}

function cleanTranslation(raw: unknown, fields: FormField[]): FormTranslation {
  if (!isObject(raw)) return {};
  const out: FormTranslation = {};
  for (const key of ['consent', 'button', 'sent', 'failed'] as const) {
    const value = words(raw[key], key === 'consent' ? 600 : 300);
    if (value) out[key] = value;
  }
  const labels: Record<string, string> = {};
  const options: Record<string, string[]> = {};
  for (const field of fields) {
    const label = isObject(raw.labels) ? words(raw.labels[field.id], 200) : '';
    if (label) labels[field.id] = label;
    const given = isObject(raw.options) && Array.isArray(raw.options[field.id]) ? (raw.options[field.id] as unknown[]) : [];
    // One word for each option of the main language, in its order; a missing one shows the main language's.
    const list = field.options.map((_, i) => words(given[i], 120));
    if (list.some(Boolean)) options[field.id] = list;
  }
  if (Object.keys(labels).length) out.labels = labels;
  if (Object.keys(options).length) out.options = options;
  return out;
}

/** One form as the site keeps it: what cannot be a field is left out, and every word has a value. */
export function normalizeForm(raw: unknown, fallback: FormWords): Form | null {
  if (!isObject(raw)) return null;
  const name = slugify(raw.name).slice(0, 60);
  if (!name) return null;
  const taken = new Set<string>();
  const fields = (Array.isArray(raw.fields) ? raw.fields : [])
    .map((f) => cleanField(f, taken))
    .filter((f): f is FormField => f !== null)
    .slice(0, MAX_FORM_FIELDS);
  const translations: Record<string, FormTranslation> = {};
  if (isObject(raw.translations)) {
    for (const [language, value] of Object.entries(raw.translations).slice(0, 10)) {
      if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)) translations[language] = cleanTranslation(value, fields);
    }
  }
  return {
    name,
    title: words(raw.title, 120) || name,
    fields,
    consent: words(raw.consent, 600) || fallback.formConsent,
    button: words(raw.button, 60) || fallback.formSend,
    sent: words(raw.sent, 300) || fallback.formSent,
    failed: words(raw.failed, 300) || fallback.formFailed,
    translations,
  };
}

/** The site's forms: each name once, at most MAX_FORMS. */
export function normalizeForms(input: unknown, fallback: FormWords): Form[] {
  const seen = new Set<string>();
  const out: Form[] = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const form = normalizeForm(raw, fallback);
    if (!form || seen.has(form.name)) continue;
    seen.add(form.name);
    out.push(form);
    if (out.length === MAX_FORMS) break;
  }
  return out;
}

/** What a field is shown with in a language: its label, and its options as the visitor reads them (each sent as the main language's). */
export interface ShownField extends FormField {
  /** The options' words in this language, one for each of `options`. */
  shown: string[];
}
export interface ShownForm extends Omit<Form, 'fields' | 'translations'> {
  fields: ShownField[];
}

/** A form in a language: its words there, the main language's where none is given. */
export function formIn(form: Form, language: string): ShownForm {
  const own = form.translations[language] ?? {};
  return {
    name: form.name,
    title: form.title,
    consent: own.consent || form.consent,
    button: own.button || form.button,
    sent: own.sent || form.sent,
    failed: own.failed || form.failed,
    fields: form.fields.map((field) => ({
      ...field,
      label: own.labels?.[field.id] || field.label,
      shown: field.options.map((option, i) => own.options?.[field.id]?.[i] || option),
    })),
  };
}

/** The form a block shows: the one it names. A block from before forms had a name shows the contact form. */
export const formOf = (block: Pick<Block, 'content'>): string => (typeof block.content.form === 'string' && block.content.form) || 'contact';

/** Each form block in these blocks, with the form it names. */
export function formBlocks(blocks: Block[]): { block: Block; form: string }[] {
  const out: { block: Block; form: string }[] = [];
  const walk = (list: Block[]): void => {
    for (const block of list) {
      if (block.type === 'form') out.push({ block, form: formOf(block) });
      if (block.children) walk(block.children);
    }
  };
  walk(blocks);
  return out;
}

/** One answer as it is kept: the field, its label as the visitor read it in the main language, and what they gave. */
export interface Answer {
  id: string;
  label: string;
  value: string;
}

const EMAIL = /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/;
export const isEmail = (value: string): boolean => value.length <= 254 && EMAIL.test(value);
const PHONE = /^\+?[\d\s().\/-]{3,40}$/;
const NUMBER = /^-?\d{1,20}([.,]\d{1,8})?$/;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * What a visitor sent, checked field by field (ADR 0049 d4): the answers to
 * keep, or the field that is wrong. `values` gives every value sent under a
 * name, as a form sends several for the boxes of one field.
 */
export function checkAnswers(form: Pick<Form, 'fields'>, values: (name: string) => string[]): { answers: Answer[] } | { wrong: string } {
  const answers: Answer[] = [];
  for (const field of form.fields) {
    const given = values(field.id).map((v) => v.trim()).filter(Boolean);
    const value = field.kind === 'checkboxes' ? [...new Set(given)].join(', ') : (given[0] ?? '');
    if (!value) {
      if (field.required) return { wrong: field.id };
      answers.push({ id: field.id, label: field.label, value: '' });
      continue;
    }
    if (value.length > ANSWER_MAX[field.kind]) return { wrong: field.id };
    const ok =
      field.kind === 'email' ? isEmail(value)
      : field.kind === 'phone' ? PHONE.test(value)
      : field.kind === 'number' ? NUMBER.test(value)
      : field.kind === 'date' ? validDate(value)
      : field.kind === 'checkboxes' ? given.every((v) => field.options.includes(v))
      : field.kind === 'select' || field.kind === 'radio' ? field.options.includes(value)
      : field.kind === 'text' ? !/[\r\n]/.test(value)
      : true;
    if (!ok) return { wrong: field.id };
    answers.push({ id: field.id, label: field.label, value });
  }
  return { answers };
}

/** What a message kept says, as the e-mail and an older message have it: each field on its line. */
export const answersText = (answers: Answer[]): string =>
  answers
    .filter((a) => a.value)
    .map((a) => (a.value.includes('\n') ? `${a.label}:\n${a.value}` : `${a.label}: ${a.value}`))
    .join('\n\n');

/** A message as the CSV file is made from it. */
export interface MessageRow {
  receivedAt: string;
  page: string;
  name: string;
  email: string;
  body: string;
  consent: string;
  answers?: Answer[];
}

/** A cell of a CSV file: quoted, and never read by a spreadsheet as a formula. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * A form's messages as a CSV file (ADR 0049 d5): when it came, the page, one
 * column for each field, and what the visitor agreed to. The fields are the
 * form's as it is, then any a message has that the form no longer does. A
 * message from before forms had fields gives its name, address and words.
 */
export function messagesCsv(form: Pick<Form, 'fields'> | null, messages: MessageRow[], headings: { receivedAt: string; page: string; consent: string }): string {
  const columns = new Map<string, string>((form?.fields ?? []).map((f) => [f.id, f.label]));
  for (const m of messages) for (const a of m.answers ?? []) if (!columns.has(a.id)) columns.set(a.id, a.label);
  const old: Record<string, (m: MessageRow) => string> = { name: (m) => m.name, email: (m) => m.email, message: (m) => m.body };
  if (!columns.size) for (const [id, label] of [['name', 'Name'], ['email', 'Email'], ['message', 'Message']] as const) columns.set(id, label);
  const ids = [...columns.keys()];
  const lines = [[headings.receivedAt, headings.page, ...columns.values(), headings.consent].map(cell).join(',')];
  for (const m of messages) {
    const value = (id: string): string => (m.answers ? (m.answers.find((a) => a.id === id)?.value ?? '') : (old[id]?.(m) ?? ''));
    lines.push([m.receivedAt, m.page, ...ids.map(value), m.consent].map(cell).join(','));
  }
  // The mark at the start tells a spreadsheet the file is UTF-8, so ă and ș read as they were written.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
