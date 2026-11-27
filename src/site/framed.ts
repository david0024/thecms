/**
 * A page the runtime draws itself (ADR 0064 d1, ADR 0065 d4): the site's own
 * frame, header and footer, with its theme, its main part replaced, kept from
 * search engines.
 */

export const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A short message above a page's forms: what was done, or what went wrong. */
export interface Notice {
  text: string;
  failed?: boolean;
}

/** One page: the site's frame with its title and what it holds in place of the frame's own main part (the accounts', or the shop's). */
export function framed(frame: string, title: string, inside: string, notice?: Notice, part: 'account' | 'shop' = 'account'): string {
  const said = notice
    ? `<p class="form-note shown${notice.failed ? ' form-failed' : ''}" role="${notice.failed ? 'alert' : 'status'}" data-account-notice>${escape(notice.text)}</p>`
    : '';
  const main = `<section class="b b-form b-${part}"><div class="b-in"><h1>${escape(title)}</h1>${said}${inside}</div></section>`;
  return frame
    .replace(/<title>[^<]*?(( · [^<]*)?)<\/title>/, (_whole, rest: string) => `<title>${escape(title)}${rest}</title>`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escape(title)}">`)
    .replace(/<link rel="canonical"[^>]*>\n?/, '')
    .replace('</head>', '<meta name="robots" content="noindex">\n</head>')
    .replace(/<main([^>]*)>[\s\S]*?<\/main>/, (_whole, attrs: string) => `<main${attrs}>${main}</main>`);
}
