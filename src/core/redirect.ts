/**
 * Old addresses that lead to new ones (ADR 0009).
 *
 * A site that moves here had addresses other sites and search engines still
 * point at. Each one that changed is kept as a small page that sends the
 * visitor on, so the export stays plain files and needs nothing from the host.
 */
import { isObject, str } from './util.ts';

export interface Redirect {
  /** The old address: a path that ends in `/` or in `.html`. */
  from: string;
  /** A path on this site. */
  to: string;
}

export const MAX_REDIRECTS = 5000;

const PATH = /^(\/[A-Za-z0-9._~%-]+)*\/?$/;

/** A path a file can be written at, or ''. Nothing that climbs (`..`), no query, no hidden files. */
function cleanPath(value: unknown): string {
  const path = str(value, 300);
  if (!path.startsWith('/') || !PATH.test(path) || path.split('/').some((part) => part.startsWith('.'))) return '';
  return path.endsWith('/') || /\.html?$/.test(path) ? path : `${path}/`;
}

/** Untrusted input as a clean list: one entry for each old address, none that leads to itself. */
export function normalizeRedirects(input: unknown): Redirect[] {
  const out = new Map<string, Redirect>();
  for (const raw of Array.isArray(input) ? input : []) {
    if (!isObject(raw) || out.size >= MAX_REDIRECTS) continue;
    const from = cleanPath(raw.from);
    const [path = '', hash = ''] = str(raw.to, 400).split('#');
    const to = cleanPath(path);
    if (!from || !to || from === to || from === '/' || out.has(from)) continue;
    out.set(from, { from, to: hash && /^[A-Za-z0-9._~%-]+$/.test(hash) ? `${to}#${hash}` : to });
  }
  return [...out.values()];
}

/** The file an old address is served from: `/old/` is `old/index.html`. */
export const redirectFile = (from: string): string => (from.endsWith('/') ? `${from.slice(1)}index.html` : from.slice(1));
