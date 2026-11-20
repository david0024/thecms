/**
 * Signing in to an admin that others can reach (ADR 0022).
 *
 * On someone's own computer the editor is opened with the key it printed, as
 * before. Served at a public address it has accounts: the first owner comes
 * from a link printed when it starts, everyone else from a link the owner
 * makes, and each signs in with an address and a password. A session is a
 * secret in a cookie the page's script cannot read, sent only to this site.
 */
import { NAME } from '../core/index.ts';
import { cleanEmail, type LinkKind, passwordProblem, type Role, type Store, type User } from './store.ts';

const OPEN_ROUTES = ['POST /api/session', 'DELETE /api/session', 'POST /api/link', 'POST /api/link/use'];

export const SESSION_COOKIE = `${NAME}_session`;
const SESSION_SECONDS = 30 * 86_400;
const SETUP_HOURS = 1;
const INVITE_HOURS = 72;
/** Wrong passwords for one address in a window: enough for a person who mistypes, too few to guess. */
const TRIES = 10;
const TRIES_WINDOW_MS = 15 * 60 * 1000;
const FORGET_AFTER = 10_000;

/** The admin's public address: https, or http on this machine for trying it out. Nothing after the host. */
export function cleanPublicAddress(value: string): string {
  try {
    const url = new URL(value);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return '';
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return '';
    return url.origin;
  } catch {
    return '';
  }
}

export const cookieOf = (request: Request, name = SESSION_COOKIE): string => {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
};

/** Who may do what. The owner may do everything; an editor writes and publishes pages, posts and entries, and uploads images. */
export function ownerOnly(method: string, path: string): boolean {
  if (path.startsWith('/api/import') || path === '/api/messages' || path.startsWith('/api/users')) return true;
  return (path === '/api/theme' || path === '/api/theme/publish' || path === '/api/site' || path === '/api/redirects') && method !== 'GET';
}

/** What the admin may know about the person signed in. */
export const shown = (user: User): { id: string; email: string; name: string; role: Role } => ({ id: user.id, email: user.email, name: user.name, role: user.role });

export function accounts(store: Store, publicAddress: string) {
  const secure = publicAddress.startsWith('https:');
  const failures = new Map<string, number[]>();
  const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
  const cookie = (secret: string, seconds: number): string =>
    `${SESSION_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
  const signedIn = async (user: User): Promise<Response> => json({ me: shown(user) }, 200, { 'set-cookie': cookie(await store.startSession(user.id), SESSION_SECONDS) });
  const linkUrl = (secret: string): string => `${publicAddress}/admin/#link=${secret}`;
  const hasOwner = async (): Promise<boolean> => (await store.users()).some((u) => u.role === 'owner' && u.active);

  const tooMany = (email: string, now: number): boolean => {
    const recent = (failures.get(email) ?? []).filter((at) => now - at < TRIES_WINDOW_MS);
    if (recent.length) failures.set(email, recent);
    else failures.delete(email);
    return recent.length >= TRIES;
  };
  const failed = (email: string, now: number): void => {
    failures.set(email, [...(failures.get(email) ?? []), now]);
    // Addresses made up by the thousand do not fill the memory: the oldest is forgotten first.
    if (failures.size > FORGET_AFTER) failures.delete(failures.keys().next().value as string);
  };

  return {
    /** A link for the first owner, while the site has none; printed when the server starts. */
    async setupLink(): Promise<string> {
      if (await hasOwner()) return '';
      return linkUrl(await store.makeLink('setup', '', SETUP_HOURS));
    },

    /** The person a request's session signs in, or null. */
    user: (request: Request): Promise<User | null> => store.sessionUser(cookieOf(request)),

    /** The calls anyone may make: signing in and out, and a link's form. Null when the path is not one of them. */
    async open(request: Request, url: URL): Promise<Response | null> {
      const route = `${request.method} ${url.pathname}`;
      // Only its own calls' bodies are read: a body is read once, and the rest are for the admin's calls.
      if (!OPEN_ROUTES.includes(route)) return null;
      const body = request.method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
      const text = (key: string): string => (typeof body[key] === 'string' ? (body[key] as string) : '');
      switch (route) {
        case 'POST /api/session': {
          const email = text('email').trim().toLowerCase();
          const now = Date.now();
          if (tooMany(email, now)) return json({ error: 'too many wrong passwords; wait a quarter of an hour', signIn: true }, 429);
          const user = await store.checkPassword(email, text('password'));
          if (!user) {
            failed(email, now);
            return json({ error: 'that address and password do not match', signIn: true }, 401);
          }
          failures.delete(email);
          return signedIn(user);
        }
        case 'DELETE /api/session':
          await store.endSession(cookieOf(request));
          return json({ signedOut: true }, 200, { 'set-cookie': cookie('', 0) });
        case 'POST /api/link': {
          const link = await store.link(text('secret'));
          if (!link || (link.kind === 'setup' && (await hasOwner()))) return json({ error: 'this link has been used or has run out' }, 410);
          return json({ kind: link.kind, email: link.user?.email ?? '', name: link.user?.name ?? '' });
        }
        default: {
          // POST /api/link/use, the last of OPEN_ROUTES.
          const link = await store.link(text('secret'));
          if (!link) return json({ error: 'this link has been used or has run out' }, 410);
          return this.useLink(link.kind, link.user, text('secret'), text('name'), text('email'), text('password'));
        }
      }
    },

    async useLink(kind: LinkKind, user: User | null, secret: string, name: string, email: string, password: string): Promise<Response> {
      // What was typed is checked before the link is spent, so a short password can be tried again.
      const problem = passwordProblem(password) || (kind === 'setup' && !cleanEmail(email) ? 'that is not an email address' : '');
      if (problem) return json({ error: problem }, 400);
      if (kind === 'setup' ? await hasOwner() : !user) return json({ error: 'this link has been used or has run out' }, 410);
      // Spending it is the database's one answer: two requests with the same link do not both get in.
      if (!(await store.link(secret, true))) return json({ error: 'this link has been used or has run out' }, 410);
      let who: User;
      if (kind === 'setup') who = await store.addUser({ email, name, role: 'owner', password });
      else {
        await store.setPassword((user as User).id, password, kind === 'invite' ? name : undefined);
        who = (await store.user((user as User).id)) as User;
      }
      return signedIn(who);
    },

    /** The owner's calls about people: who has an account, inviting, links, roles, removing. */
    async people(request: Request, url: URL, me: User): Promise<Response> {
      const body = request.method === 'POST' || request.method === 'PUT' ? ((await request.json()) as Record<string, unknown>) : {};
      const listed = async () => ({ users: await store.users(), me: shown(me) });
      if (url.pathname === '/api/users/link' && request.method === 'POST') {
        const user = await store.user(String(body.id ?? ''));
        if (!user) return json({ error: 'nobody has that account' }, 404);
        return json({ link: linkUrl(await store.makeLink(user.active ? 'reset' : 'invite', user.id, INVITE_HOURS)), ...(await listed()) });
      }
      if (url.pathname !== '/api/users') return json({ error: 'not found' }, 404);
      switch (request.method) {
        case 'GET':
          return json(await listed());
        case 'POST': {
          const user = await store.addUser({ email: String(body.email ?? ''), role: body.role === 'owner' ? 'owner' : 'editor' });
          return json({ link: linkUrl(await store.makeLink('invite', user.id, INVITE_HOURS)), ...(await listed()) });
        }
        case 'PUT':
          await store.setRole(String(body.id ?? ''), body.role === 'owner' ? 'owner' : 'editor');
          return json(await listed());
        case 'DELETE':
          await store.removeUser(url.searchParams.get('id') ?? '');
          return json(await listed());
        default:
          return json({ error: 'not found' }, 404);
      }
    },
  };
}
