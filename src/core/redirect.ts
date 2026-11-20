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

/**
 * The list with one more old address leading to a new one (ADR 0036): what
 * led to the old address now leads straight to the new one, so no visitor
 * goes through two hops, and nothing leads away from an address that is
 * answered again.
 */
export function addRedirect(list: readonly Redirect[], from: string, to: string): Redirect[] {
  const target = (r: Redirect): string => r.to.split('#')[0] as string;
  const moved = list.filter((r) => r.from !== to && r.from !== from).map((r) => (target(r) === from ? { ...r, to: to + r.to.slice(from.length) } : r));
  return normalizeRedirects([...moved, { from, to }]);
}

/** What is wrong with a list of redirects, for the check before publishing (ADR 0036). */
export interface RedirectProblem {
  from: string;
  to: string;
  /** `loop`: following it comes back to where it started. `chain`: it leads to another old address. `missing`: it leads nowhere on the site. `shadowed`: a page lives at the old address, so it is never followed. */
  problem: 'loop' | 'chain' | 'missing' | 'shadowed';
}

/** Each redirect that loops, chains, leads nowhere or is hidden by a page, given the addresses the site answers. */
export function redirectProblems(list: readonly Redirect[], answered: ReadonlySet<string>): RedirectProblem[] {
  const next = new Map(list.map((r) => [r.from, r.to.split('#')[0] as string]));
  const out: RedirectProblem[] = [];
  for (const { from, to } of list) {
    const target = to.split('#')[0] as string;
    if (answered.has(from)) {
      out.push({ from, to, problem: 'shadowed' });
      continue;
    }
    const seen = new Set([from]);
    let at = target;
    while (next.has(at) && !seen.has(at) && !answered.has(at)) {
      seen.add(at);
      at = next.get(at) as string;
    }
    if (seen.has(at)) out.push({ from, to, problem: 'loop' });
    else if (next.has(target) && !answered.has(target)) out.push({ from, to, problem: 'chain' });
    else if (!answered.has(target)) out.push({ from, to, problem: 'missing' });
  }
  return out;
}

/** The redirects as Cloudflare Pages and Netlify read them: one `from to 301` a line. */
export const redirectsFile = (list: readonly Redirect[]): string => list.map((r) => `${r.from} ${r.to} 301`).join('\n') + (list.length ? '\n' : '');

/** The same for Apache. */
export const htaccessFile = (list: readonly Redirect[]): string => list.map((r) => `Redirect 301 ${r.from} ${r.to}`).join('\n') + (list.length ? '\n' : '');
