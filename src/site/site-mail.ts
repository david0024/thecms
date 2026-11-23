/**
 * The site's mail server, as the owner sets it in Settings → E-mail (ADR 0064
 * d5), and the messages the site sends to visitors. `THECMS_SMTP` and
 * `THECMS_MAIL_FROM`, when given, are stronger than the settings.
 */
import { wordsFor } from '../blocks/words.ts';
import { isEmail, type Mailer, smtpMailer } from './mail.ts';
import type { Store } from './store.ts';
import './languages.ts';

export interface MailSettings {
  host: string;
  port: number;
  /** TLS from the start, or plain, which is only for a server on this machine (ADR 0019). */
  security: 'tls' | 'plain';
  user: string;
  /** Kept as the site's other secrets are, and never given back to the admin. */
  password: string;
  /** The sender's address. */
  from: string;
}

export const NO_MAIL: MailSettings = { host: '', port: 465, security: 'tls', user: '', password: '', from: '' };

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function normalizeMailSettings(input: unknown): MailSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const port = Math.round(Number(raw.port));
  const security = raw.security === 'plain' ? 'plain' : 'tls';
  return {
    host: text(raw.host, 255).replace(/[^a-zA-Z0-9.\-[\]:]/g, ''),
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : security === 'tls' ? 465 : 25,
    security,
    user: text(raw.user, 255),
    password: typeof raw.password === 'string' ? raw.password.slice(0, 500) : '',
    from: isEmail(text(raw.from, 254)) ? text(raw.from, 254) : '',
  };
}

/** The settings as an address smtpMailer reads, or '' when no server is set. */
export function mailAddress(settings: MailSettings): string {
  if (!settings.host) return '';
  const who = settings.user ? `${encodeURIComponent(settings.user)}${settings.password ? `:${encodeURIComponent(settings.password)}` : ''}@` : '';
  return `${settings.security === 'tls' ? 'smtps' : 'smtp'}://${who}${settings.host}:${settings.port}`;
}

/** What the environment gives (`THECMS_SMTP`, `THECMS_MAIL_FROM`), stronger than the settings. */
export interface MailEnvironment {
  mailer?: Mailer | null;
  from?: string;
}

/**
 * How the site sends mail now: the environment's server, or the one in the
 * settings; and the sender. Null while either is missing.
 */
export async function siteMailer(store: Store, environment: MailEnvironment = {}): Promise<{ mailer: Mailer; from: string } | null> {
  const settings = normalizeMailSettings(await store.mailSettings());
  const from = environment.from && isEmail(environment.from) ? environment.from : settings.from;
  let mailer = environment.mailer ?? null;
  if (!mailer) {
    try {
      mailer = smtpMailer(mailAddress(settings) || undefined);
    } catch {
      mailer = null;
    }
  }
  return mailer && from ? { mailer, from } : null;
}

/** The messages the site sends a visitor (ADR 0064 d5), then those of the shop's orders (ADR 0065 d7). */
export const TEMPLATES = ['confirm', 'reset', 'welcome', 'invite', 'deleted', 'orderReceived', 'orderPaid', 'orderSent', 'orderCancelled', 'orderNew'] as const;
/** The shop's: offered in Settings → E-mail only while the shop is on (ADR 0065 d10). */
export const ORDER_TEMPLATES: readonly TemplateName[] = ['orderReceived', 'orderPaid', 'orderSent', 'orderCancelled', 'orderNew'];
export type TemplateName = (typeof TEMPLATES)[number];
export interface Template {
  subject: string;
  text: string;
}
/**
 * The owner's words, by language, then by message; what is not there is the
 * program's, or the extension's. A message an extension declares is kept as
 * `extension:message` (ADR 0064, "The extensions' messages").
 */
export type Templates = Record<string, Record<string, Template>>;

/** The key an extension's message is kept under: `club:receipt`. */
export const EXTENSION_MAIL = /^[a-z][a-z0-9-]{1,39}:[a-z][a-z0-9-]{1,39}$/;
export const extensionMailKey = (extension: string, message: string): string => `${extension}:${message}`;

type WordKey = keyof ReturnType<typeof wordsFor>;
const KEYS: Record<TemplateName, [WordKey, WordKey]> = {
  confirm: ['mailConfirmSubject', 'mailConfirmText'],
  reset: ['mailResetSubject', 'mailResetText'],
  welcome: ['mailWelcomeSubject', 'mailWelcomeText'],
  invite: ['mailInviteSubject', 'mailInviteText'],
  deleted: ['mailDeletedSubject', 'mailDeletedText'],
  orderReceived: ['mailOrderReceivedSubject', 'mailOrderReceivedText'],
  orderPaid: ['mailOrderPaidSubject', 'mailOrderPaidText'],
  orderSent: ['mailOrderSentSubject', 'mailOrderSentText'],
  orderCancelled: ['mailOrderCancelledSubject', 'mailOrderCancelledText'],
  orderNew: ['mailOrderNewSubject', 'mailOrderNewText'],
};

/** The program's words for a message, in a language (English where the language has no pack). */
export function defaultTemplate(name: TemplateName, language: string): Template {
  const said = wordsFor(language);
  const [subject, body] = KEYS[name];
  return { subject: said[subject], text: said[body] };
}

export function normalizeTemplates(input: unknown): Templates {
  const out: Templates = {};
  if (!input || typeof input !== 'object') return out;
  for (const [language, kept] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(language) || !kept || typeof kept !== 'object') continue;
    for (const [name, value] of Object.entries(kept as Record<string, unknown>)) {
      if (!TEMPLATES.includes(name as TemplateName) && !EXTENSION_MAIL.test(name)) continue;
      const one = value as Record<string, unknown> | undefined;
      if (!one || typeof one !== 'object') continue;
      const subject = text(one.subject, 200).replace(/[\r\n]+/g, ' ');
      const body = typeof one.text === 'string' ? one.text.slice(0, 5000) : '';
      if (subject && body.trim()) (out[language] ??= {})[name] = { subject, text: body };
    }
  }
  return out;
}

/** What a message says of an order (ADR 0065 d7): its number, its total, the order itself as text, and its tracking number. */
export type OrderValues = Partial<Record<'number' | 'total' | 'order' | 'tracking', string>>;

/** A message in a language: the owner's words where they gave them, with `{name}`, `{link}` and `{site}` filled in (and an order's words, for the shop's). */
export function renderTemplate(templates: Templates, name: TemplateName, language: string, values: { name: string; link: string; site: string } & OrderValues): Template {
  const chosen = templates[language]?.[name] ?? defaultTemplate(name, language);
  const fill = (words: string): string => words.replace(/\{(name|link|site|number|total|order|tracking)\}/g, (_whole, key: keyof typeof values) => values[key] ?? '');
  return { subject: fill(chosen.subject).replace(/[\r\n]+/g, ' '), text: fill(chosen.text) };
}

/** The owner's words for an extension's messages, forgotten with the extension (ADR 0064). */
export function withoutExtension(templates: Templates, extension: string): Templates {
  const out: Templates = {};
  for (const [language, kept] of Object.entries(templates)) {
    const left = Object.fromEntries(Object.entries(kept).filter(([name]) => !name.startsWith(`${extension}:`)));
    if (Object.keys(left).length) out[language] = left;
  }
  return out;
}
