/**
 * The admin bar (ADR 0075): a strip over the site's pages for a person signed
 * in to the admin, as WordPress has. It is added by the server to the page it
 * answers, only for a request that carries a session; a visitor gets the page
 * as it was made, the same bytes the cache keeps. It is plain links, one form
 * to sign out and a few lines of style: no script, nothing kept in the browser.
 */
import { applyPack, type Catalog, format, type LanguagePack } from '../core/language.ts';
import { en } from '../admin/messages.ts';
import { writesAll, type Role } from './store.ts';

/** What an address of the site is in the editor: a page, or an entry of a type. */
export interface EditTarget {
  /** `page`, or the entry's type. */
  kind: string;
  /** What the editor opens it by (`ro/<address>` for a translation). */
  slug: string;
  /** The main page's or entry's address: what its draft, and an entry's author, are kept by. */
  main: string;
  /** For an entry: what one of its type is called. */
  singular?: string;
}

/** Who is signed in. */
export interface BarPerson {
  name: string;
  role: Role;
}

/** What the server knows of this page and this person, for the bar. */
export interface BarFacts {
  target: EditTarget | null;
  /** Who wrote the entry, when it is one ('' for nobody). */
  author: string | null;
  /** The person's own id. */
  me: string;
  /** The site's posts, when it has them: what an author adds. */
  posts: { singular: string } | null;
  /** The page or entry has changes its visitors do not see yet. */
  changed: boolean;
}

export interface BarLinks {
  /** The editor at this page, when the person may change it. */
  edit?: { href: string; label: string; changed: boolean };
  /** A new page, or a new entry, when the person may write one. */
  add?: { href: string; label: string };
}

/** What waits for the owner and the editors; a zero is not shown. */
export interface Waiting {
  comments: number;
  review: number;
  orders: number;
}

type Words = typeof en.siteBar;

const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The editor's address for a screen (`#at=…`), written as the admin writes it. */
export const adminAt = (at: string): string => `/admin/#at=${encodeURIComponent(at).replaceAll('%2F', '/').replaceAll('%3A', ':')}`;

/** Where the form to sign out is sent. */
export const SIGN_OUT_PATH = '/admin/sign-out';

/** The bar's words, in the admin's language. */
export const barWords = (pack: LanguagePack | null): Words => (applyPack({ admin: en } as unknown as Catalog, pack).admin as unknown as typeof en).siteBar;

/**
 * Which links the bar has for this person on this page. A page is the owner's
 * and the editors' to change; an entry also its author's, unless they only
 * send theirs for review (a contributor: a published entry is an editor's).
 */
export function barLinks(person: BarPerson, facts: BarFacts, words: Words, language: string): BarLinks {
  const { target } = facts;
  const links: BarLinks = {};
  const singular = (target?.singular ?? '').toLowerCase();
  if (target?.kind === 'page' && writesAll(person.role)) links.edit = { href: adminAt(`edit/page/${target.slug}`), label: words.editPage, changed: facts.changed };
  if (target && target.kind !== 'page' && (writesAll(person.role) || (facts.author === facts.me && person.role !== 'contributor')))
    links.edit = { href: adminAt(`edit/${target.kind}/${target.slug}`), label: format(words.editEntry, { singular }, language), changed: facts.changed };
  if (writesAll(person.role)) links.add = { href: adminAt('new/page'), label: words.newPage };
  else if (facts.posts) links.add = { href: adminAt('new/posts'), label: format(words.newEntry, { singular: facts.posts.singular.toLowerCase() }, language) };
  return links;
}

/**
 * The bar's own style. Every rule starts at `#uhlaka-bar`, so a theme's rules
 * for links, forms or buttons do not reach it, and it reaches nothing of the
 * page. It keeps its own colours in light and dark, as the admin is light
 * (ADR 0074 d8) and the bar belongs to the admin.
 */
const STYLE = `#uhlaka-bar{all:initial;display:flex;align-items:stretch;gap:2px;box-sizing:border-box;width:100%;min-height:36px;padding:0 8px;background:#151a33;color:#eef0fa;font:500 14px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-x:auto;white-space:nowrap;position:relative;z-index:2147483000;border-bottom:1px solid #2a3266}
#uhlaka-bar a,#uhlaka-bar button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;padding:0 10px;min-height:36px;color:#eef0fa;cursor:pointer}
#uhlaka-bar span,#uhlaka-bar form,#uhlaka-bar input{all:unset}
#uhlaka-bar form{display:flex}
#uhlaka-bar input{display:none}
#uhlaka-bar a:hover,#uhlaka-bar button:hover{background:#2a3266;color:#fff}
#uhlaka-bar a:focus-visible,#uhlaka-bar button:focus-visible{outline:2px solid #9aabff;outline-offset:-2px}
#uhlaka-bar .uhlaka-bar-changed{padding:2px 7px;border-radius:999px;background:#f2b84b;color:#151a33;font-size:12px;font-weight:600}
#uhlaka-bar .uhlaka-bar-count{min-width:18px;padding:1px 6px;border-radius:999px;background:#d6455d;color:#fff;font-size:12px;font-weight:700;text-align:center;box-sizing:border-box}
#uhlaka-bar .uhlaka-bar-me{margin-left:auto;color:#c9cde6}
#uhlaka-bar svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
@media (max-width:600px){#uhlaka-bar .uhlaka-bar-short{display:none}}
@media print{#uhlaka-bar{display:none}}`;

const ICON = {
  admin: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  comments: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  review: '<path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  orders: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
};
const icon = (name: keyof typeof ICON): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

/**
 * The bar, as markup. `back` is the address the person is on, where signing
 * out leaves them, as a visitor.
 */
export function barHtml(person: BarPerson, links: BarLinks, waiting: Waiting, words: Words, language: string, back: string): string {
  const word = (text: string, short = false): string => `<span${short ? ' class="uhlaka-bar-short"' : ''}>${esc(text)}</span>`;
  const link = (href: string, name: keyof typeof ICON, inside: string, data: string, extra = ''): string => `<a href="${esc(href)}" data-bar="${data}"${extra}>${icon(name)}${inside}</a>`;
  // A number in the bar says what it counts to whoever cannot see the icon, and on hover.
  const count = (n: number, name: 'comments' | 'review' | 'orders', at: string): string => {
    if (n <= 0) return '';
    const said = format(words[name], { count: n }, language);
    return link(adminAt(at), name, `<span class="uhlaka-bar-count">${n}</span>`, name, ` title="${esc(said)}" aria-label="${esc(said)}"`);
  };
  const edit = links.edit;
  return [
    `<nav id="uhlaka-bar" aria-label="${esc(words.label)}" lang="${esc(language)}">`,
    link('/admin/', 'admin', word(words.admin), 'admin'),
    edit ? link(edit.href, 'edit', `${word(edit.label)}${edit.changed ? `<span class="uhlaka-bar-changed" data-bar-changed>${esc(words.changed)}</span>` : ''}`, 'edit', edit.changed ? ` title="${esc(words.changedHint)}"` : '') : '',
    // On a phone some words give way to their icon: the link keeps its name for whoever reads it out.
    links.add ? link(links.add.href, 'add', word(links.add.label, true), 'add', ` aria-label="${esc(links.add.label)}"`) : '',
    count(waiting.comments, 'comments', 'comments'),
    count(waiting.review, 'review', 'review'),
    count(waiting.orders, 'orders', 'orders'),
    link(adminAt('me'), 'me', word(person.name || words.admin, true), 'me', ` class="uhlaka-bar-me" title="${esc(format(words.me, { name: person.name }, language))}" aria-label="${esc(format(words.me, { name: person.name || words.admin }, language))}"`),
    `<form method="post" action="${SIGN_OUT_PATH}" data-bar="sign-out"><input type="hidden" name="back" value="${esc(back)}"><button type="submit" title="${esc(words.signOut)}" aria-label="${esc(words.signOut)}">${icon('out')}${word(words.signOut, true)}</button></form>`,
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

/** Where signing out may lead: an address of this site, never another's. */
export const backTo = (value: string | null): string => (value && /^\/(?![/\\])[^\s\\]*$/.test(value) ? value : '/');
