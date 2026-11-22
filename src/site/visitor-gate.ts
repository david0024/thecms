/**
 * The door to visitor accounts (ADR 0064 d8, ADR 0060 d3): while the owner
 * has not turned them on, nothing of them is loaded, their tables do not
 * exist and `/_/account` is not found. Turned on, the accounts are loaded the
 * first time they are needed, and make their tables then.
 */
import type { MailEnvironment } from './site-mail.ts';
import type { Shared } from './shared.ts';
import type { Store, User } from './store.ts';

/** Who may make an account (ADR 0064 d2). */
export type Signup = 'open' | 'invite' | 'closed';
export const SIGNUPS: readonly Signup[] = ['open', 'invite', 'closed'];

export interface VisitorSettings {
  /** The one switch of Settings → Visitor accounts. */
  on: boolean;
  signup: Signup;
  /** The site's privacy page, linked beside the consent on the sign-up form; '' for none. */
  privacy: string;
}

export const VISITORS_OFF: VisitorSettings = { on: false, signup: 'closed', privacy: '' };

export function normalizeVisitorSettings(input: unknown): VisitorSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const privacy = typeof raw.privacy === 'string' ? raw.privacy.trim().slice(0, 500) : '';
  return {
    on: raw.on === true,
    signup: SIGNUPS.includes(raw.signup as Signup) ? (raw.signup as Signup) : 'closed',
    // A page of the site, or an address on the web; nothing a link could run.
    privacy: /^(\/(?!\/)|https?:\/\/)[^\s"<>]*$/.test(privacy) ? privacy : '',
  };
}

/** What the accounts are given by the runtime that serves them. */
export interface VisitorDeps {
  shared: Shared;
  log: (line: string) => void;
  /** The mail server from the environment, stronger than the settings (ADR 0064 d5). */
  mail: MailEnvironment;
  /** The site's frame in a language (its page for a missing address), or null while nothing is published. */
  frame: (language: string) => Promise<string | null>;
  /** What every page of the site says to the browser. */
  headers: Record<string, string>;
}

/** What the accounts do, once loaded (`visitors.ts`). */
export interface Visitors {
  fetch: (request: Request, url: URL, ip: string) => Promise<Response>;
  chores: (now: Date) => Promise<void>;
  admin: (request: Request, url: URL, me: User, body: Record<string, unknown>) => Promise<Response>;
}

export interface VisitorGate {
  settings: () => Promise<VisitorSettings>;
  /** `/_/account` and what is under it: not found while the accounts are off. */
  fetch: (request: Request, url: URL, ip: string) => Promise<Response>;
  /** What the site's clock does for them: send what waits, forget what has run out. Nothing while off. */
  chores: (now: Date) => Promise<void>;
  /** The owner's calls under `/api/visitors` (the admin's Settings → Visitor accounts). */
  admin: (request: Request, url: URL, me: User, body: Record<string, unknown>) => Promise<Response>;
  /** Whether the accounts' code was loaded in this process: never, while they stay off (the tests ask). */
  loaded: () => boolean;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export function visitorGate(store: Store, deps: VisitorDeps, mailReady: () => Promise<boolean>): VisitorGate {
  let loading: Promise<Visitors> | null = null;
  const open = (): Promise<Visitors> => {
    loading ??= import('./visitors.ts').then((m) => m.openVisitors(store, deps)).catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  };
  const settings = async (): Promise<VisitorSettings> => normalizeVisitorSettings(await store.visitorSettings());

  return {
    settings,
    async fetch(request, url, ip) {
      if (!(await settings()).on) return new Response('not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      return (await open()).fetch(request, url, ip);
    },
    async chores(now) {
      if (!(await settings()).on) return;
      await (await open()).chores(now);
    },
    async admin(request, url, me, body) {
      const now = await settings();
      if (url.pathname === '/api/visitors' && request.method === 'PUT') {
        const asked = normalizeVisitorSettings({ ...now, ...body });
        // Confirming an address and a forgotten password need mail that works (ADR 0064 d2).
        if (asked.on && asked.signup === 'open' && !(await mailReady())) return json({ error: 'open sign-up needs a mail server: set one in Settings → E-mail first' }, 409);
        await store.setVisitorSettings(asked);
        if (!asked.on) return json({ settings: asked, mail: await mailReady() });
      } else if (!now.on) {
        // Off: only the settings, and nothing is loaded or made.
        return url.pathname === '/api/visitors' && request.method === 'GET' ? json({ settings: now, mail: await mailReady() }) : json({ error: 'visitor accounts are off' }, 404);
      }
      return (await open()).admin(request, url, me, body);
    },
    loaded: () => loading !== null,
  };
}
