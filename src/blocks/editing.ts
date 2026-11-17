/**
 * The editor draws the same components as the public site, with one
 * difference: text an author can type on the page is marked (`data-edit`), and
 * a field that is still empty is drawn so there is somewhere to type.
 *
 * On the public site `mark` returns undefined, Svelte leaves the attribute
 * out, and the HTML is exactly what it was before the editor existed.
 */
import { getContext, setContext } from 'svelte';
import type { ContentType, Post } from '../core/index.ts';

const KEY = 'thecms:editing';

export const setEditing = (on: boolean): void => {
  setContext(KEY, on);
};

export const isEditing = (): boolean => getContext(KEY) === true;

/** `mark('items.0.title')` → the attribute value in the editor, nothing on the public site. */
export const marker = (): ((path: string) => string | undefined) => {
  const on = isEditing();
  return (path) => (on ? path : undefined);
};

/**
 * What a block that lists entries can list (ADR 0011): each content type with
 * the entries to show, in the order its own list shows them. The export gives
 * what is published; the editor, the drafts.
 */
export type EntryLists = Record<string, { type: ContentType; entries: Post[] }>;

const LISTS = 'thecms:lists';

export const setLists = (lists: EntryLists, language: string): void => {
  setContext(LISTS, { lists, language });
};

export const getLists = (): { lists: EntryLists; language: string } =>
  (getContext(LISTS) as { lists: EntryLists; language: string } | undefined) ?? { lists: {}, language: 'en' };
