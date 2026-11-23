/**
 * Pages behind a password (ADR 0043), as the visitor meets them. The runtime
 * asks for the password in a page of the site's own and, given the right
 * one, keeps a key in the visitor's browser that opens that page. An export
 * cannot ask for anything, so there the page says it cannot be opened.
 */
import { wordsFor } from '../blocks/words.ts';
import './languages.ts';

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The cookie that holds a page's key: one for each page, named by it. */
export const lockCookie = (slug: string): string => `thecms-page-${new Bun.CryptoHasher('sha256').update(slug).digest('hex').slice(0, 16)}`;

/**
 * The page a visitor sees in place of one behind a password: the site's
 * frame (its page for a missing address) asking for it, at `back`, or, in an
 * export, saying it cannot be opened.
 */
export function lockedPage(frame: string, back: string | null): string {
  const language = /<html lang="([^"]+)"/.exec(frame)?.[1] ?? 'en';
  const said = wordsFor(language);
  const form =
    back === null
      ? `<p class="lead">${escape(said.lockedStatic)}</p>`
      : `<p class="lead">${escape(said.lockedHint)}</p>` +
        `<p class="form-note form-failed" id="locked-wrong" role="alert">${escape(said.lockedWrong)}</p>` +
        `<form class="form" method="post" action="/_/unlock" accept-charset="utf-8"><input type="hidden" name="back" value="${escape(back)}">` +
        `<p class="form-field"><label for="locked-password">${escape(said.lockedPassword)}</label><input id="locked-password" name="password" type="password" maxlength="200" autocomplete="current-password" required></p>` +
        `<p><button class="button" type="submit">${escape(said.lockedOpen)}</button></p></form>`;
  return closedPage(frame, said.locked, form);
}

/** In an export, the page in place of one for members (ADR 0064 d4): a static host knows nobody, so it says it cannot be opened. */
export function membersPage(frame: string): string {
  const said = wordsFor(/<html lang="([^"]+)"/.exec(frame)?.[1] ?? 'en');
  return closedPage(frame, said.members, `<p class="lead">${escape(said.membersStatic)}</p>`);
}

/** The site's frame with a title and what is said in place of a page that is not open to this visitor. */
function closedPage(frame: string, title: string, inside: string): string {
  const main = `<section class="b b-form"><div class="b-in"><h1>${escape(title)}</h1>${inside}</div></section>`;
  return frame
    .replace(/<title>[^<]*?(( · [^<]*)?)<\/title>/, (_whole, rest: string) => `<title>${escape(title)}${rest}</title>`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escape(title)}">`)
    .replace('</head>', '<meta name="robots" content="noindex">\n</head>')
    .replace(/<main([^>]*)>[\s\S]*?<\/main>/, (_whole, attrs: string) => `<main${attrs}>${main}</main>`);
}
