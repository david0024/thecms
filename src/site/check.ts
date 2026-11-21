/**
 * What a site would get wrong once it is published (ADR 0029), read from the
 * files an export writes: a link to an address on the site that nothing
 * answers, and a picture with no words for those who cannot see it.
 *
 * It reads the output, not the pages, so every link counts: one typed in a
 * text, a button, the menu, the footer. A link is to the site when it starts
 * with one `/`; one elsewhere is not followed.
 */

export interface SiteCheck {
  /** An address nothing answers, and the pages that link to it. Publishing stops on these. */
  broken: { href: string; from: string[] }[];
  /** A picture with no description, and the pages that show it. Said, not stopped. */
  unnamed: { src: string; on: string[] }[];
  /** A translation that still shows words of the main language (ADR 0032 d6): its address, and how many. Said, not stopped. */
  untranslated?: { slug: string; language: string; missing: number }[];
  /** A redirect that loops, leads to another old address, leads nowhere, or is hidden by a page (ADR 0036). Said, not stopped. */
  redirects?: RedirectProblem[];
  /**
   * What only the site's own server does, which an export to a static host
   * would lose (ADR 0044): said, so the owner knows before choosing one.
   */
  server?: ServerOnly[];
}

export type ServerOnly = 'forms' | 'comments' | 'search' | 'locked' | 'extensions';

/** What the built site uses that only its own server answers. A form service elsewhere answers forms and comments. */
export function serverOnly(files: Map<string, string | Uint8Array>, options: { formsElsewhere?: boolean; routes?: boolean } = {}): ServerOnly[] {
  const pages = [...files.values()].filter((f): f is string => typeof f === 'string');
  const uses = (text: string): boolean => pages.some((page) => page.includes(text));
  const found: ServerOnly[] = [];
  if (!options.formsElsewhere && uses('action="/_/send"')) found.push('forms');
  if (!options.formsElsewhere && uses('action="/_/comment"')) found.push('comments');
  if (uses('action="/_/search"')) found.push('search');
  if (uses('<meta name="thecms-locked"')) found.push('locked');
  if (options.routes) found.push('extensions');
  return found;
}

import { type Redirect, type RedirectProblem, redirectProblems } from '../core/index.ts';

const LINK = /<a\b[^>]*?\shref="([^"]*)"/g;
const IMAGE = /<img\b[^>]*>/g;
const ATTRIBUTE = (name: string) => new RegExp(`\\s${name}="([^"]*)"`);

const unescape = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The address a file is served at: `about/index.html` is `/about/`. */
const addressOf = (file: string): string => `/${file.replace(/(^|\/)index\.html$/, '$1')}`;

/** Whether one of the files answers an address. */
function answers(files: Map<string, unknown>, href: string): boolean {
  let path = href.split(/[?#]/)[0] ?? href;
  try {
    path = decodeURI(path);
  } catch {
    return false;
  }
  if (path.endsWith('/')) return files.has(`${path.slice(1)}index.html`);
  return files.has(path.slice(1)) || files.has(`${path.slice(1)}/index.html`);
}

function add<T extends string>(map: Map<string, Set<string>>, key: T, where: string): void {
  const at = map.get(key) ?? new Set<string>();
  at.add(where);
  map.set(key, at);
}

export function checkSite(files: Map<string, string | Uint8Array>): SiteCheck {
  const broken = new Map<string, Set<string>>();
  const unnamed = new Map<string, Set<string>>();
  for (const [file, contents] of files) {
    if (!file.endsWith('.html') || typeof contents !== 'string') continue;
    const page = addressOf(file);
    for (const [, raw = ''] of contents.matchAll(LINK)) {
      const href = unescape(raw);
      if (!href.startsWith('/') || href.startsWith('//')) continue;
      // The same address with another part after it is the same address.
      if (!answers(files, href)) add(broken, href.split(/[?#]/)[0] ?? href, page);
    }
    for (const [tag] of contents.matchAll(IMAGE)) {
      const alt = tag.match(ATTRIBUTE('alt'))?.[1] ?? '';
      if (alt.trim()) continue;
      add(unnamed, unescape(tag.match(ATTRIBUTE('src'))?.[1] ?? ''), page);
    }
  }
  const sorted = (map: Map<string, Set<string>>) => [...map].sort(([a], [b]) => a.localeCompare(b)).map(([key, at]) => [key, [...at].sort()] as const);
  return {
    broken: sorted(broken).map(([href, from]) => ({ href, from })),
    unnamed: sorted(unnamed).map(([src, on]) => ({ src, on })),
  };
}

/** What is wrong with the redirects, against the pages the export wrote (its own redirect pages are not pages). */
export function checkRedirects(files: Map<string, string | Uint8Array>, redirects: readonly Redirect[]): RedirectProblem[] {
  const answered = new Set<string>();
  for (const [file, contents] of files) {
    if (file.endsWith('.html') && typeof contents === 'string' && !contents.includes('http-equiv="refresh"')) answered.add(addressOf(file));
  }
  return redirectProblems(redirects, answered);
}

const STATIC: Record<ServerOnly, string> = {
  forms: 'the contact forms have nowhere to send (set a form service in Site settings)',
  comments: 'comments cannot be sent (set a form service in Site settings)',
  search: 'the search field finds nothing',
  locked: 'the pages behind a password cannot be opened',
  extensions: 'the addresses extensions answer at, under /_/x/, do not exist',
};

const SAID: Record<RedirectProblem['problem'], string> = {
  loop: 'comes back to itself',
  chain: 'leads to another old address; point it straight at the new one',
  missing: 'leads to an address the site does not have',
  shadowed: 'is never followed: a page lives at the old address',
};

/** The findings in plain lines, for the command line. */
export function describeCheck(check: SiteCheck): { problems: string[]; warnings: string[] } {
  const pages = (list: readonly string[]): string => (list.length > 3 ? `${list.slice(0, 3).join(', ')} and ${list.length - 3} more` : list.join(', '));
  return {
    problems: check.broken.map((b) => `${b.href} does not exist; linked from ${pages(b.from)}`),
    warnings: [
      ...check.unnamed.map((u) => `${u.src} has no description, on ${pages(u.on)}`),
      ...(check.redirects ?? []).map((r) => `the redirect from ${r.from} to ${r.to} ${SAID[r.problem]}`),
      ...(check.server ?? []).map((what) => `on a static host, ${STATIC[what]}`),
      ...(check.untranslated ?? []).map((u) => `/${u.slug}/ shows ${u.missing === 1 ? '1 text' : `${u.missing} texts`} in the main language, not translated into ${u.language}`),
    ],
  };
}
