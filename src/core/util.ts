/** Small helpers the core shares. Nothing here knows about a database or a browser. */

export type Issue = { path: string; message: string };

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A string, trimmed of control characters and cut to `max`. Anything else is ''. */
export function str(value: unknown, max = 300): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

export const newId = (): string => `b_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

/** "Despre noi!" → "despre-noi". Empty when nothing usable is left. */
export function slugify(value: unknown): string {
  return str(value, 200)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * An address a visitor may follow: http(s), mailto, tel, a path on this site
 * or an anchor. Everything else (`javascript:`, `data:`, `//host`) is ''.
 */
export function safeHref(value: unknown): string {
  const v = str(value, 2000).trim();
  if (!v) return '';
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) return v;
  if (v.startsWith('#')) return v;
  if (v.startsWith('/') && !v.startsWith('//') && !v.includes('\\')) return v;
  return '';
}

/** Where an image may come from: http(s) or a path on this site. */
export function safeSrc(value: unknown): string {
  const v = safeHref(value);
  return /^(https?:\/\/|\/)/i.test(v) ? v : '';
}
