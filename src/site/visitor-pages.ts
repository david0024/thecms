/**
 * The pages of a visitor's account (ADR 0064 d1), in the site's own frame,
 * header and footer, with its theme, in the visitor's language, and without
 * script: each is a form the browser sends by itself.
 */
import { type Words, wordsFor } from '../blocks/words.ts';
import './languages.ts';

export const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A short message above a page's forms: what was done, or what went wrong. */
export interface Notice {
  text: string;
  failed?: boolean;
}

/** One page: the site's frame with its title and what it holds in place of the frame's own main part. */
export function framed(frame: string, title: string, inside: string, notice?: Notice): string {
  const said = notice
    ? `<p class="form-note shown${notice.failed ? ' form-failed' : ''}" role="${notice.failed ? 'alert' : 'status'}" data-account-notice>${escape(notice.text)}</p>`
    : '';
  const main = `<section class="b b-form b-account"><div class="b-in"><h1>${escape(title)}</h1>${said}${inside}</div></section>`;
  return frame
    .replace(/<title>[^<]*?(( · [^<]*)?)<\/title>/, (_whole, rest: string) => `<title>${escape(title)}${rest}</title>`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escape(title)}">`)
    .replace(/<link rel="canonical"[^>]*>\n?/, '')
    .replace('</head>', '<meta name="robots" content="noindex">\n</head>')
    .replace(/<main([^>]*)>[\s\S]*?<\/main>/, (_whole, attrs: string) => `<main${attrs}>${main}</main>`);
}

/** The pieces a page's forms are made of. */
export function parts(language: string, query: string) {
  const said: Words = wordsFor(language);
  /** An address under /_/account, in this language. */
  const at = (path: string, extra = ''): string => `/_/account${path}${query}${extra ? `${query ? '&amp;' : '?'}${extra}` : ''}`;
  let fields = 0;
  const field = (label: string, name: string, type: string, attrs = '', value = '', hint = ''): string => {
    const id = `account-${name}-${++fields}`;
    return (
      `<p class="form-field"><label for="${id}">${escape(label)}</label>` +
      `<input id="${id}" name="${name}" type="${type}"${value ? ` value="${escape(value)}"` : ''} ${attrs}>` +
      `${hint ? `<small>${escape(hint)}</small>` : ''}</p>`
    );
  };
  const form = (path: string, inside: string, button: string, hidden: Record<string, string> = {}): string =>
    `<form class="form" method="post" action="${at(path)}" accept-charset="utf-8">` +
    Object.entries(hidden)
      .map(([name, value]) => `<input type="hidden" name="${name}" value="${escape(value)}">`)
      .join('') +
    `${inside}<p><button class="button" type="submit">${escape(button)}</button></p></form>`;
  const name = (value = ''): string => field(said.accountName, 'name', 'text', 'maxlength="120" autocomplete="name" required', value);
  const email = (value = '', autocomplete = 'email'): string => field(said.accountEmail, 'email', 'email', `maxlength="254" autocomplete="${autocomplete}" required`, value);
  const password = (label: string, autocomplete: 'current-password' | 'new-password'): string =>
    field(label, autocomplete === 'new-password' ? 'password' : 'current', 'password', `minlength="${autocomplete === 'new-password' ? 10 : 1}" maxlength="200" autocomplete="${autocomplete}" required`, '', autocomplete === 'new-password' ? said.accountPasswordHint : '');
  const consent = (privacy: string): string =>
    `<p class="form-field form-consent"><label><input type="checkbox" name="consent" value="yes" required> ${escape(said.accountConsent)}</label>` +
    `${privacy ? ` <a href="${escape(privacy)}">${escape(said.accountPrivacy)}</a>` : ''}</p>`;
  const link = (path: string, words: string): string => `<a href="${at(path)}">${escape(words)}</a>`;
  return { said, at, field, form, name, email, password, consent, link };
}
