/**
 * The admin bar (ADR 0075): a strip over the site's pages for a person signed
 * in to the admin, as WordPress has. It is added by the server to the page it
 * answers, only for a request that carries a session; a visitor gets the page
 * as it was made, the same bytes the cache keeps. It is plain links and a few
 * lines of style: no script, nothing kept in the browser.
 */
import { applyPack, type Catalog, format, type LanguagePack } from '../core/language.ts';
import { en } from '../admin/messages.ts';
import { writesAll, type Role } from './store.ts';

/** What an address of the site is in the editor: a page, or an entry of a type. */
export interface EditTarget {
  /** `page`, or the entry's type. */
  kind: string;
  /** What the editor opens it by (`ro/<address>` for an entry in another language). */
  slug: string;
  /** For an entry: the main entry's address, by which its author is known. */
  entry?: string;
  /** For an entry: what one of its type is called. */
  singular?: string;
}

/** Who is signed in, and what they may do on this page. */
export interface BarPerson {
  name: string;
  role: Role;
}

export interface BarLinks {
  /** The editor at this page, when the person may change it. */
  edit?: { href: string; label: string };
  /** A new page, or a new entry, when the person may write one. */
  add?: { href: string; label: string };
}

type Words = typeof en.siteBar;

const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The editor's address for a screen (`#at=…`), written as the admin writes it. */
export const adminAt = (at: string): string => `/admin/#at=${encodeURIComponent(at).replaceAll('%2F', '/').replaceAll('%3A', ':')}`;

/** The bar's words, in the admin's language. */
export const barWords = (pack: LanguagePack | null): Words => (applyPack({ admin: en } as unknown as Catalog, pack).admin as unknown as typeof en).siteBar;

/**
 * Which links the bar has for this person on this page. A page is the owner's
 * and the editors' to change; an entry also its author's, unless they only
 * send theirs for review (a contributor: a published entry is an editor's).
 */
export function barLinks(person: BarPerson, target: EditTarget | null, words: Words, language: string, author: string | null, me: string, posts: { singular: string } | null): BarLinks {
  const links: BarLinks = {};
  const singular = (target?.singular ?? '').toLowerCase();
  if (target?.kind === 'page' && writesAll(person.role)) links.edit = { href: adminAt(`edit/page/${target.slug}`), label: words.editPage };
  if (target && target.kind !== 'page' && (writesAll(person.role) || (author === me && person.role !== 'contributor')))
    links.edit = { href: adminAt(`edit/${target.kind}/${target.slug}`), label: format(words.editEntry, { singular }, language) };
  if (writesAll(person.role)) links.add = { href: adminAt('new/page'), label: words.newPage };
  else if (posts) links.add = { href: adminAt('new/posts'), label: format(words.newEntry, { singular: posts.singular.toLowerCase() }, language) };
  return links;
}

/**
 * The bar's own style. Every rule starts at `#uhlaka-bar`, so a theme's rules
 * for links or lists do not reach it, and it reaches nothing of the page. It
 * keeps its own colours in light and dark, as the admin is light (ADR 0074 d8)
 * and the bar belongs to the admin.
 */
const STYLE = `#uhlaka-bar{all:initial;display:flex;align-items:stretch;gap:2px;box-sizing:border-box;width:100%;min-height:36px;padding:0 8px;background:#151a33;color:#eef0fa;font:500 14px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-x:auto;white-space:nowrap;position:relative;z-index:2147483000}
#uhlaka-bar a{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;padding:0 10px;min-height:36px;color:#eef0fa;cursor:pointer;border-radius:0}
#uhlaka-bar span{all:unset}
#uhlaka-bar a:hover{background:#2a3266;color:#fff}
#uhlaka-bar a:focus-visible{outline:2px solid #9aabff;outline-offset:-2px}
#uhlaka-bar .uhlaka-bar-me{margin-left:auto;color:#c9cde6}
#uhlaka-bar svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
@media (max-width:480px){#uhlaka-bar .uhlaka-bar-me span{display:none}}
@media print{#uhlaka-bar{display:none}}`;

const ICON = {
  admin: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};
const icon = (name: keyof typeof ICON): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

/** The bar, as markup. */
export function barHtml(person: BarPerson, links: BarLinks, words: Words, language: string): string {
  const link = (href: string, name: keyof typeof ICON, label: string, data: string, extra = ''): string =>
    `<a href="${esc(href)}" data-bar="${data}"${extra}>${icon(name)}<span>${esc(label)}</span></a>`;
  return [
    `<nav id="uhlaka-bar" aria-label="${esc(words.label)}" lang="${esc(language)}">`,
    link('/admin/', 'admin', words.admin, 'admin'),
    links.edit ? link(links.edit.href, 'edit', links.edit.label, 'edit') : '',
    links.add ? link(links.add.href, 'add', links.add.label, 'add') : '',
    link(adminAt('me'), 'me', person.name || words.admin, 'me', ` class="uhlaka-bar-me" title="${esc(format(words.me, { name: person.name }, language))}"`),
    '</nav>',
  ].join('');
}

/** A page with the bar's style at the end of its head and the bar first in its body; a page without them is left as it is. */
export function withBar(html: string, bar: string): string {
  const head = html.indexOf('</head>');
  const body = head < 0 ? -1 : html.indexOf('<body', head);
  const open = body < 0 ? -1 : html.indexOf('>', body);
  if (open < 0) return html;
  return `${html.slice(0, head)}<style id="uhlaka-bar-style">${STYLE}</style>\n${html.slice(head, open + 1)}\n${bar}${html.slice(open + 1)}`;
}
