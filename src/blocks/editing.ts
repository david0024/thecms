/**
 * The editor draws the same components as the public site, with one
 * difference: text an author can type on the page is marked (`data-edit`), and
 * a field that is still empty is drawn so there is somewhere to type.
 *
 * On the public site `mark` returns undefined, Svelte leaves the attribute
 * out, and the HTML is exactly what it was before the editor existed.
 */
import { getContext, setContext } from 'svelte';
import { type ContentType, type Post, pictureAttrs, type Share, type Site } from '../core/index.ts';

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

/**
 * The entry a content type's page is drawn for (ADR 0015), and which part of
 * that page the editor is changing: the entry's own blocks (`entry`), the
 * type's page around them (`template`), or neither, for a visitor.
 */
export interface EntryContext {
  post: Post;
  type: ContentType;
  language: string;
  editing: 'entry' | 'template' | null;
  /** Already inside the entry's own blocks: a part met there draws nothing, so a page never holds itself. */
  inBody?: boolean;
}

const ENTRY = 'thecms:entry';

export const setEntry = (entry: EntryContext): void => {
  setContext(ENTRY, entry);
};

export const getEntry = (): EntryContext | undefined => getContext(ENTRY) as EntryContext | undefined;

const SITE = 'thecms:site';

/** The site a page is drawn for, and the page's own address: what a form needs to know to send and to come back. */
export const setSite = (site: Site, path: string): void => {
  setContext(SITE, { site, path });
};
export const getSite = (): { site: Site; path: string } | undefined => getContext(SITE) as { site: Site; path: string } | undefined;

const LISTS = 'thecms:lists';

export const setLists = (lists: EntryLists, language: string): void => {
  setContext(LISTS, { lists, language });
};

export const getLists = (): { lists: EntryLists; language: string } =>
  (getContext(LISTS) as { lists: EntryLists; language: string } | undefined) ?? { lists: {}, language: 'en' };

const MEASURE = 'thecms:measure';

/** How wide the content runs where a block is drawn, so a picture in it can say which copy fits (ADR 0005 d8). */
export const setMeasure = (layout: string, measure: string): void => {
  setContext(MEASURE, { layout, measure });
};
export const getMeasure = (): { layout: string; measure: string } => (getContext(MEASURE) as { layout: string; measure: string } | undefined) ?? { layout: 'normal', measure: '100vw' };

/** `pic(src, 'full')` → srcset, sizes, width and height for this picture, here; nothing in the editor or for a picture the site does not hold. */
export const picture = (): ((src: string, share: Share) => ReturnType<typeof pictureAttrs>) => {
  const pictures = getSite()?.site.pictures;
  const { measure } = getMeasure();
  return (src, share) => pictureAttrs(pictures, src, measure, share);
};
