/**
 * The editor draws the same components as the public site, with one
 * difference: text an author can type on the page is marked (`data-edit`), and
 * a field that is still empty is drawn so there is somewhere to type.
 *
 * On the public site `mark` returns undefined, Svelte leaves the attribute
 * out, and the HTML is exactly what it was before the editor existed.
 */
import { getContext, setContext } from 'svelte';

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
