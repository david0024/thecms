/**
 * The door to visitor accounts (ADR 0064 d8, ADR 0060 d3): while the owner
 * has not turned them on, nothing of them is loaded, their tables do not
 * exist and `/_/account` is not found. Turned on, the accounts are loaded the
 * first time they are needed, and make their tables then.
 */
import { type Audience, type Level, NAME, normalizeLevels } from '../../core/index.ts';
import type { Member } from '../../site/extension-runner.ts';
import type { MailEnvironment } from '../../site/site-mail.ts';
import type { Shared } from '../../site/shared.ts';
import { escape, framed } from './pages.ts';
import { wordsFor } from '../../blocks/words.ts';
import type { Store, User } from '../../site/store.ts';

/** Who may make an account (ADR 0064 d2). */
export type Signup = 'open' | 'invite' | 'closed';
export const SIGNUPS: readonly Signup[] = ['open', 'invite', 'closed'];

export interface VisitorSettings {
  /** The one switch of Settings → Visitor accounts. */
  on: boolean;
  signup: Signup;
  /** The site's privacy page, linked beside the consent on the sign-up form; '' for none. */
  privacy: string;
  /** The member levels the owner named (ADR 0064 d3). */
  levels: Level[];
  /** The level each new account receives, '' for none. */
  welcome: string;
}

export const VISITORS_OFF: VisitorSettings = { on: false, signup: 'closed', privacy: '', levels: [], welcome: '' };

export function normalizeVisitorSettings(input: unknown): VisitorSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const privacy = typeof raw.privacy === 'string' ? raw.privacy.trim().slice(0, 500) : '';
  const levels = normalizeLevels(raw.levels);
  return {
    on: raw.on === true,
    signup: SIGNUPS.includes(raw.signup as Signup) ? (raw.signup as Signup) : 'closed',
    // A page of the site, or an address on the web; nothing a link could run.
    privacy: /^(\/(?!\/)|https?:\/\/)[^\s"<>]*$/.test(privacy) ? privacy : '',
    levels,
    welcome: levels.some((l) => l.id === raw.welcome) ? (raw.welcome as string) : '',
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
  /** A visitor's orders, shown in "My account" while the shop is on (ADR 0065 d4); '' otherwise. */
  orders?: (visitorId: string, language: string) => Promise<string>;
}

/** A message an extension sends a visitor (ADR 0064 d7): its words in the visitor's language, or the site's welcome. */
export type LentMail = { what: string; words: (language: string) => { subject: string; text: string } } | 'welcome';

/**
 * What the accounts lend extensions (ADR 0064 d7). Each is refused while the
 * accounts are off, and a visitor is one whose address is confirmed.
 */
export interface AccountsLent {
  get: (id: string) => Promise<Member | null>;
  find: (email: string) => Promise<Member | null>;
  levels: () => Promise<Level[]>;
  /** Gives or takes a level the owner named; the visitor's levels after. */
  give: (id: string, level: string) => Promise<string[]>;
  take: (id: string, level: string) => Promise<string[]>;
  /** Puts a message to the visitor in the queue; `link` is already an address the extension may give. */
  send: (id: string, mail: LentMail, link: string) => Promise<void>;
  /** The visitor signed in on this request, by id and levels; never the cookie. */
  visitor: (request: Request) => Promise<{ id: string; levels: string[] } | null>;
}

/** What the accounts do, once loaded (`visitors.ts`). */
export interface Visitors {
  fetch: (request: Request, url: URL, ip: string) => Promise<Response>;
  chores: (now: Date) => Promise<void>;
  admin: (request: Request, url: URL, me: User, body: Record<string, unknown>) => Promise<Response>;
  guard: (request: Request, url: URL, audience: Audience, language: string) => Promise<Response | null>;
  lent: AccountsLent;
}

export interface VisitorGate {
  settings: () => Promise<VisitorSettings>;
  /** `/_/account` and what is under it: not found while the accounts are off. */
  fetch: (request: Request, url: URL, ip: string) => Promise<Response>;
  /** What the site's clock does for them: send what waits, forget what has run out. Nothing while off. */
  chores: (now: Date) => Promise<void>;
  /** The owner's calls under `/api/visitors` (the admin's Settings → Visitor accounts). */
  admin: (request: Request, url: URL, me: User, body: Record<string, unknown>) => Promise<Response>;
  /**
   * A page for visitors signed in, or for members (ADR 0064 d4): null when
   * this visitor may see it; otherwise the page they get in its place, with
   * the sign-in form, or a line saying the page is for members. While the
   * accounts are off, nobody may.
   */
  guard: (request: Request, url: URL, audience: Audience, language: string) => Promise<Response | null>;
  /** What extensions are lent (ADR 0064 d7): refused while off, and nothing is loaded for it. */
  lent: AccountsLent;
  /** Whether the accounts' code was loaded in this process: never, while they stay off (the tests ask). */
  loaded: () => boolean;
}

/** The accounts' cookie is in the request: only then is the session worth asking for. */
const hasCookie = (request: Request): boolean => (request.headers.get('cookie') ?? '').split(';').some((part) => part.trim().startsWith(`${NAME}_visitor=`));

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
  const lend = async <T>(use: (lent: AccountsLent) => Promise<T>): Promise<T> => {
    if (!(await settings()).on) throw new Error('visitor accounts are off: the owner turns them on in Settings → Visitor accounts');
    return use((await open()).lent);
  };

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
        // Asked when it is turned on: what else the owner changes later is saved, even while the mail server fails.
        const opening = asked.on && asked.signup === 'open' && !(now.on && now.signup === 'open');
        if (opening && !(await mailReady())) return json({ error: 'open sign-up needs a mail server: set one in Settings → E-mail first' }, 409);
        await store.setVisitorSettings(asked);
        if (!asked.on) return json({ settings: asked, mail: await mailReady() });
      } else if (!now.on) {
        // Off: only the settings, and nothing is loaded or made.
        return url.pathname === '/api/visitors' && request.method === 'GET' ? json({ settings: now, mail: await mailReady() }) : json({ error: 'visitor accounts are off' }, 404);
      }
      return (await open()).admin(request, url, me, body);
    },
    async guard(request, url, audience, language) {
      if ((await settings()).on) return (await open()).guard(request, url, audience, language);
      // Off: the page stays closed to everyone, and nothing of the accounts is loaded (ADR 0064 d8).
      const frame = await deps.frame(language);
      const said = wordsFor(language);
      const body = frame === null ? `${said.membersClosed}\n` : framed(frame, said.members, `<p class="lead">${escape(said.membersClosed)}</p>`);
      return new Response(body, { status: 403, headers: { 'content-type': frame === null ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8', 'cache-control': 'private, no-store', ...deps.headers } });
    },
    lent: {
      get: (id) => lend((l) => l.get(id)),
      find: (email) => lend((l) => l.find(email)),
      levels: () => lend((l) => l.levels()),
      give: (id, level) => lend((l) => l.give(id, level)),
      take: (id, level) => lend((l) => l.take(id, level)),
      send: (id, mail, link) => lend((l) => l.send(id, mail, link)),
      // Off, or no cookie: nobody is signed in, and nothing is loaded to say so.
      visitor: async (request) => (hasCookie(request) && (await settings()).on ? (await open()).lent.visitor(request) : null),
    },
    loaded: () => loading !== null,
  };
}
