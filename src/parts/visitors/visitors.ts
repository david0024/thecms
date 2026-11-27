/**
 * Visitor accounts (ADR 0064 d1, d2, d5, d6): apart from the admin's people,
 * in tables, a cookie and pages of their own. Loaded only once the owner has
 * turned them on (`visitor-gate.ts`, ADR 0060 d3).
 *
 * A password is kept as its hash (argon2id), a session and a one-time link as
 * the hash of their secret, and wrong passwords are counted where the site's
 * processes share them, as for the admin (ADR 0022). Mail waits in a queue the
 * site's clock sends, so no request waits for a mail server.
 */
import { createHash } from 'node:crypto';
import { type Audience, languageName, mayView, NAME, type Site } from '../../core/index.ts';
import { openMailQueue } from '../../site/mail-queue.ts';
import { normalizeTemplates, renderTemplate, siteMailer, type TemplateName } from '../../site/site-mail.ts';
import { cleanEmail, PASSWORD_MIN, type Database, type Store, type User } from '../../site/store.ts';
import { type Notice, escape, framed, parts } from './pages.ts';
import { type AccountsLent, normalizeVisitorSettings, type VisitorDeps, type Visitors, type VisitorSettings } from './gate.ts';
import { visitorSchema } from './schema.ts';

export const VISITOR_COOKIE = `${NAME}_visitor`;
const SESSION_DAYS = 30;
/** How long a link sent by e-mail lasts (ADR 0064 d1). */
const LINK_HOURS = 24;
/** An account whose address is not confirmed in this time is deleted (ADR 0064 d6). */
const UNCONFIRMED_DAYS = 7;
const PASSWORD_MAX = 200;
/** Wrong passwords for one address in a window, as for the admin. */
const TRIES = 10;
const TRIES_MS = 15 * 60_000;
/** Messages asked for one address, and from one visitor, in an hour: enough for a person, too few to fill someone's mailbox. */
const MAILS_PER_ADDRESS = 3;
const MAILS_PER_VISITOR = 10;
const HOUR = 3_600_000;
/** Messages extensions may send one visitor in an hour (ADR 0064 d7). */
const LENT_MAILS_PER_VISITOR = 10;

const hashed = (value: string): string => createHash('sha256').update(value).digest('hex');
const newSecret = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
let decoy: Promise<string> | null = null;
const checkHash = async (password: string, hash: string): Promise<boolean> => {
  const against = hash || (await (decoy ??= Bun.password.hash(newSecret(), { algorithm: 'argon2id' })));
  return password.length <= PASSWORD_MAX && (await Bun.password.verify(password, against)) && hash !== '';
};

/** A visitor, as the owner's Settings and the visitor's own data show them (ADR 0064 d6). */
export interface Visitor {
  id: string;
  email: string;
  name: string;
  language: string;
  createdAt: string;
  confirmedAt: string | null;
  lastAt: string | null;
  /** Invited by the owner, and not yet taken up. */
  invited: boolean;
  /** The member levels held, by id (ADR 0064 d3). */
  levels: string[];
}

type Row = Record<string, unknown>;
type LinkKind = 'confirm' | 'reset' | 'invite' | 'email';
const asVisitor = (row: Row): Visitor => ({
  id: String(row.id),
  email: String(row.email),
  name: String(row.name),
  language: String(row.language),
  createdAt: String(row.created_at),
  confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
  lastAt: row.last_at ? String(row.last_at) : null,
  invited: !row.confirmed_at && !String(row.password),
  levels: [],
});

export async function openVisitors(store: Store, deps: VisitorDeps): Promise<Visitors> {
  const db: Database = store.database();
  await db.make(visitorSchema(db.kind));
  const { shared, log } = deps;
  const one = async (query: string, params: unknown[]): Promise<Row | null> => (await db.rows<Row>(query, params))[0] ?? null;

  // The accounts' rows.
  const levelsOf = async (id: string): Promise<string[]> => (await db.rows<Row>('SELECT level FROM visitor_levels WHERE visitor_id = ? ORDER BY level', [id])).map((r) => String(r.level));
  const withLevels = async (row: Row): Promise<Visitor & { password: string }> => ({ ...asVisitor(row), password: String(row.password), levels: await levelsOf(String(row.id)) });
  const byEmail = async (email: string): Promise<(Visitor & { password: string }) | null> => {
    const row = await one('SELECT * FROM visitors WHERE email = ?', [email]);
    return row ? withLevels(row) : null;
  };
  const byId = async (id: string): Promise<(Visitor & { password: string }) | null> => {
    const row = id ? await one('SELECT * FROM visitors WHERE id = ?', [id]) : null;
    return row ? withLevels(row) : null;
  };
  /**
   * What extensions are told of a member's levels (ADR 0064 d7): only of an
   * account whose address is confirmed, and only when something changed.
   */
  const changed = async (id: string, before: string[], after: string[]): Promise<void> => {
    const added = after.filter((l) => !before.includes(l));
    const removed = before.filter((l) => !after.includes(l));
    if (!added.length && !removed.length) return;
    if (!(await one('SELECT id FROM visitors WHERE id = ? AND confirmed_at IS NOT NULL', [id]))) return;
    store.tell('member.changed', { id, levels: after, added, removed });
  };
  /**
   * The levels a visitor holds, given and taken at once (ADR 0064 d3): only
   * levels the owner named. Told to extensions, unless the account is being
   * made, which tells its levels with it.
   */
  const setLevels = async (id: string, levels: string[], tell = true): Promise<string[]> => {
    const known = new Set(normalizeVisitorSettings(await store.visitorSettings()).levels.map((l) => l.id));
    const before = await levelsOf(id);
    await db.run('DELETE FROM visitor_levels WHERE visitor_id = ?', [id]);
    for (const level of new Set(levels)) if (known.has(level)) await db.run('INSERT INTO visitor_levels (visitor_id, level) VALUES (?, ?)', [id, level]);
    const after = await levelsOf(id);
    if (tell) await changed(id, before, after);
    return after;
  };
  /** A new account receives the level the owner chose for new accounts, if any; then extensions are told it was made. */
  const welcomed = async (id: string): Promise<void> => {
    const { welcome } = normalizeVisitorSettings(await store.visitorSettings());
    if (welcome) await setLevels(id, [...(await levelsOf(id)), welcome], false);
    store.tell('account.made', { id, levels: await levelsOf(id) });
  };
  const remove = async (id: string): Promise<void> => {
    const was = await byId(id);
    await db.run('DELETE FROM visitor_levels WHERE visitor_id = ?', [id]);
    await db.run('DELETE FROM visitor_sessions WHERE visitor_id = ?', [id]);
    await db.run('DELETE FROM visitor_links WHERE visitor_id = ?', [id]);
    await db.run('DELETE FROM visitors WHERE id = ?', [id]);
    // An account never confirmed was never told as made.
    if (was?.confirmedAt) store.tell('account.removed', { id, levels: was.levels });
  };

  // Sessions: the secret in the visitor's cookie, its hash here.
  const startSession = async (id: string, now = new Date()): Promise<string> => {
    const secret = newSecret();
    await db.run('INSERT INTO visitor_sessions (id, visitor_id, expires_at) VALUES (?, ?, ?)', [hashed(secret), id, new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString()]);
    await db.run('UPDATE visitors SET last_at = ? WHERE id = ?', [now.toISOString().slice(0, 10), id]);
    return secret;
  };
  const sessionVisitor = async (secret: string, now = new Date()): Promise<(Visitor & { password: string }) | null> => {
    if (!secret) return null;
    const row = await one('SELECT visitor_id, expires_at FROM visitor_sessions WHERE id = ?', [hashed(secret)]);
    if (!row) return null;
    if (String(row.expires_at) <= now.toISOString()) {
      await db.run('DELETE FROM visitor_sessions WHERE id = ?', [hashed(secret)]);
      return null;
    }
    return byId(String(row.visitor_id));
  };

  // One-time links, sent by e-mail.
  const makeLink = async (kind: LinkKind, id: string, data: unknown = {}, now = new Date()): Promise<string> => {
    const secret = newSecret();
    await db.run('INSERT INTO visitor_links (id, kind, visitor_id, data, expires_at) VALUES (?, ?, ?, ?, ?)', [hashed(secret), kind, id, JSON.stringify(data), new Date(now.getTime() + LINK_HOURS * HOUR).toISOString()]);
    return secret;
  };
  /** A link that has not run out; spent, it is the database's one answer, so two requests do not both use it. */
  const link = async (secret: string, spend = false, now = new Date()): Promise<{ kind: LinkKind; visitor: Visitor & { password: string }; data: Record<string, unknown> } | null> => {
    if (!secret || secret.length > 100) return null;
    const row = await one('SELECT kind, visitor_id, data, expires_at FROM visitor_links WHERE id = ?', [hashed(secret)]);
    if (!row || String(row.expires_at) <= now.toISOString()) return null;
    const visitor = await byId(String(row.visitor_id));
    if (!visitor) return null;
    if (spend && (await db.changed('DELETE FROM visitor_links WHERE id = ?', [hashed(secret)])) !== 1) return null;
    return { kind: String(row.kind) as LinkKind, visitor, data: JSON.parse(String(row.data)) as Record<string, unknown> };
  };

  // The site's queue (ADR 0064 d5), shared with the shop (ADR 0065 d7).
  const siteOf = (): Promise<Site> => store.site();
  const mails = await openMailQueue(store, deps.mail, log);
  const queue = mails.queue;
  const enqueue = async (to: string, what: TemplateName, language: string, values: { name: string; link: string }): Promise<void> => {
    const site = await siteOf();
    await queue(to, what, renderTemplate(normalizeTemplates(await store.mailTemplates()), what, language, { ...values, site: site.name }));
  };

  /** What the clock does: forget what has run out, delete accounts never confirmed (ADR 0064 d6). The queue is sent by the runtime. */
  const chores = async (now: Date): Promise<void> => {
    const at = now.toISOString();
    await db.run('DELETE FROM visitor_sessions WHERE expires_at <= ?', [at]);
    await db.run('DELETE FROM visitor_links WHERE expires_at <= ?', [at]);
    const old = await db.rows<Row>('SELECT id FROM visitors WHERE confirmed_at IS NULL AND created_at <= ?', [new Date(now.getTime() - UNCONFIRMED_DAYS * 86_400_000).toISOString()]);
    for (const row of old) await remove(String(row.id));
  };

  // Limits, counted where the processes share them, by the address's hash: never the address itself, nor kept.
  const tooMany = async (email: string): Promise<boolean> => (await shared.count(`visitor-tries:${hashed(email)}`)) >= TRIES;
  const failed = (email: string): Promise<number> => shared.hit(`visitor-tries:${hashed(email)}`, TRIES_MS);
  const mayMail = async (email: string, ip: string): Promise<boolean> =>
    (await shared.hit(`visitor-mail:${hashed(email)}`, HOUR)) <= MAILS_PER_ADDRESS && (await shared.hit(`visitor-mail-from:${hashed(ip || 'unknown')}`, HOUR)) <= MAILS_PER_VISITOR;

  // What a visitor's browser is told.
  const cookieOf = (request: Request): string => {
    for (const part of (request.headers.get('cookie') ?? '').split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === VISITOR_COOKIE) return rest.join('=');
    }
    return '';
  };
  const secureOf = (request: Request, url: URL): boolean => url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const cookie = (secure: boolean, secret: string, seconds: number): string =>
    `${VISITOR_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
  const page = (body: string, status = 200, headers: Record<string, string> = {}): Response =>
    new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', ...deps.headers, ...headers } });
  const plain = (words: string, status: number): Response => new Response(`${words}\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  /** Where a link in a message leads: the site's own address, or the one the visitor came to. */
  const baseOf = (site: Site, url: URL): string => {
    try {
      const own = new URL(site.url);
      if (own.protocol === 'https:' || own.protocol === 'http:') return own.origin;
    } catch {
      // No address set: the one asked.
    }
    return url.origin;
  };

  /** The language a page is drawn in: the one asked for, the visitor's, or the site's. */
  const languageOf = (site: Site, asked: string, visitor: Visitor | null): string => {
    const all = [site.language, ...site.languages];
    if (all.includes(asked)) return asked;
    if (visitor && all.includes(visitor.language)) return visitor.language;
    return site.language;
  };

  /** A path inside the site, to go back to after signing in; anything else is the account. */
  const backOf = (value: string): string => (/^\/(?!\/)[^\s\\]*$/.test(value) && !value.startsWith('/_/account') ? value : '');

  async function fetch(request: Request, url: URL, ip: string): Promise<Response> {
    const route = url.pathname.replace(/\/+$/, '') || '/_/account';
    const site = await siteOf();
    const settings = normalizeVisitorSettings(await store.visitorSettings());
    const secret = cookieOf(request);
    const me = await sessionVisitor(secret);
    const post = request.method === 'POST';
    let fields = new URLSearchParams();
    if (post) {
      // A form of another site cannot send here (the cookie is SameSite=Lax), and a browser that says where a form came from is believed.
      const origin = request.headers.get('origin');
      if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== 'null' && new URL(origin).host !== url.host)) return plain('a form of another site', 403);
      if (Number(request.headers.get('content-length') ?? 0) > 16_384) return plain('too large', 413);
      fields = new URLSearchParams((await request.text()).slice(0, 16_384));
    } else if (request.method !== 'GET' && request.method !== 'HEAD') return plain('not found', 404);
    const field = (name: string, max = 500): string => (fields.get(name) ?? '').slice(0, max);
    const language = languageOf(site, url.searchParams.get('l') ?? field('l'), me);
    const query = language === site.language ? '' : `?l=${encodeURIComponent(language)}`;
    const { said, form, name, email, password, consent, link: linkTo } = parts(language, query);
    const frame = await deps.frame(language);
    if (frame === null) return plain('nothing is published yet', 404);
    const draw = (title: string, inside: string, notice?: Notice, status = 200, headers: Record<string, string> = {}): Response =>
      page(framed(frame, title, inside, notice), status, headers);
    /** Where a page goes after a form: the account (or `back`), with what was done said there. */
    const to = (path: string, saidKey = '', headers: Record<string, string> = {}): Response => {
      const params = new URLSearchParams();
      if (language !== site.language) params.set('l', language);
      if (saidKey) params.set('said', saidKey);
      const search = params.toString();
      return new Response(null, { status: 303, headers: { location: `${path}${search ? `${path.includes('?') ? '&' : '?'}${search}` : ''}`, 'cache-control': 'no-store', ...headers } });
    };
    const secure = secureOf(request, url);
    const signIn = async (visitor: Visitor, back = '', notice = ''): Promise<Response> =>
      to(back || '/_/account', back ? '' : notice, { 'set-cookie': cookie(secure, await startSession(visitor.id), SESSION_DAYS * 86_400) });
    const mailReady = async (): Promise<boolean> => (await siteMailer(store, deps.mail)) !== null;
    const base = baseOf(site, url);
    const linkUrl = (secret: string): string => `${base}/_/account/link?k=${secret}${language === site.language ? '' : `&l=${encodeURIComponent(language)}`}`;

    // What was done, said on the page a form led to.
    const NOTICES: Record<string, string> = {
      saved: said.accountSaved,
      confirmed: said.accountConfirmed,
      password: said.accountPasswordChanged,
      out: said.accountSignedOut,
      deleted: said.accountDeleted,
    };
    const shownNotice = (): Notice | undefined => {
      const words = NOTICES[url.searchParams.get('said') ?? ''];
      return words ? { text: words } : undefined;
    };

    const signInForm = (notice?: Notice, typed = '', back = '', status = 200): Response => {
      const signupLink = settings.signup === 'open' ? `<p>${escape(said.accountNoAccount)} ${linkTo('/signup', said.accountSignUp)}</p>` : '';
      return draw(
        said.accountSignIn,
        form('/signin', email(typed, 'username') + password(said.accountPassword, 'current-password'), said.accountSignIn, back ? { back } : {}) +
          `<p>${linkTo('/forgot', said.accountForgot)}</p>${signupLink}`,
        notice,
        status,
      );
    };
    const signupForm = (notice?: Notice, typed: { name?: string; email?: string } = {}, status = 200): Response => {
      if (settings.signup !== 'open') return draw(said.accountSignUp, `<p class="lead">${escape(settings.signup === 'invite' ? said.accountInviteOnly : said.accountClosed)}</p><p>${linkTo('', said.accountSignIn)}</p>`, undefined, 403);
      return draw(
        said.accountSignUp,
        form('/signup', name(typed.name) + email(typed.email) + password(said.accountPassword, 'new-password') + consent(settings.privacy), said.accountMake) +
          `<p>${escape(said.accountHaveAccount)} ${linkTo('', said.accountSignIn)}</p>`,
        notice,
        status,
      );
    };
    // The visitor's orders (ADR 0065 d4), while the shop is on.
    const orders = me && deps.orders ? await deps.orders(me.id, language) : '';
    const accountPage = (visitor: Visitor, notice?: Notice, status = 200): Response =>
      draw(
        said.account,
        `<p class="lead">${escape(said.accountHello.replace('{name}', visitor.name || visitor.email))}</p>` +
          form('/profile', name(visitor.name) + email(visitor.email), said.accountSave) +
          levelsPart(visitor) +
          orders +
          `<h2>${escape(said.accountChangePassword)}</h2>` +
          form('/password', password(said.accountCurrentPassword, 'current-password') + password(said.accountNewPassword, 'new-password'), said.accountChangePassword) +
          `<h2>${escape(said.accountDownload)}</h2><p><a class="button" href="/_/account/data" download>${escape(said.accountDownload)}</a></p>` +
          `<h2>${escape(said.accountDelete)}</h2><p>${escape(said.accountDeleteHint)}</p>` +
          form('/delete', password(said.accountCurrentPassword, 'current-password'), said.accountDelete) +
          form('/signout', '', said.accountSignOut),
        notice,
        status,
      );
    /** The levels held, by the names the owner gave them; nothing while the site has none. */
    const levelsPart = (visitor: Visitor): string => {
      if (!settings.levels.length) return '';
      const held = settings.levels.filter((l) => visitor.levels.includes(l.id));
      const list = held.length ? `<ul data-account-levels>${held.map((l) => `<li>${escape(l.name)}</li>`).join('')}</ul>` : `<p data-account-levels>${escape(said.accountNoLevels)}</p>`;
      return `<h2>${escape(said.accountLevels)}</h2>${list}`;
    };
    const passwordProblem = (value: string): string => (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX ? said.accountShortPassword : '');

    switch (route) {
      case '/_/account': {
        if (post) return plain('not found', 404);
        if (me) return accountPage(me, shownNotice());
        return signInForm(shownNotice(), '', backOf(url.searchParams.get('back') ?? ''));
      }
      case '/_/account/signin': {
        if (!post) return to('/_/account');
        const address = cleanEmail(field('email', 300));
        const back = backOf(field('back'));
        if (await tooMany(address)) return signInForm({ text: said.accountTooMany, failed: true }, address, back, 429);
        const visitor = address ? await byEmail(address) : null;
        const given = field('current', PASSWORD_MAX + 1);
        if (visitor?.confirmedAt && (await checkHash(given, visitor.password))) {
          await shared.del(`visitor-tries:${hashed(address)}`);
          return signIn(visitor, back);
        }
        await failed(address);
        // An address not yet confirmed, with the password it was signed up with: the link goes again.
        if (visitor && !visitor.confirmedAt) {
          const pending = await db.rows<Row>("SELECT data FROM visitor_links WHERE visitor_id = ? AND kind = 'confirm' ORDER BY expires_at DESC LIMIT 3", [visitor.id]);
          for (const row of pending) {
            const data = JSON.parse(String(row.data)) as { password?: string; name?: string; language?: string };
            if (data.password && (await checkHash(given, data.password))) {
              if (await mayMail(address, ip)) await enqueue(address, 'confirm', data.language ?? language, { name: data.name ?? '', link: linkUrl(await makeLink('confirm', visitor.id, data)) });
              return signInForm({ text: said.accountNotConfirmed, failed: true }, address, back, 403);
            }
          }
        }
        return signInForm({ text: said.accountWrong, failed: true }, address, back, 401);
      }
      case '/_/account/signup': {
        if (me) return to('/_/account');
        if (!post || settings.signup !== 'open') return signupForm();
        const typed = { name: field('name', 120).trim(), email: field('email', 300).trim() };
        const address = cleanEmail(typed.email);
        const chosen = field('password', PASSWORD_MAX + 1);
        if (!typed.name || !address || fields.get('consent') !== 'yes') return signupForm({ text: said.accountInvalid, failed: true }, typed, 400);
        const weak = passwordProblem(chosen);
        if (weak) return signupForm({ text: weak, failed: true }, typed, 400);
        if (!(await mailReady())) return signupForm({ text: said.accountNoMail, failed: true }, typed, 503);
        const checkMail = (): Response => draw(said.accountSignUp, `<p class="lead" data-account-check-mail>${escape(said.accountCheckMail.replace('{email}', address))}</p>`);
        // Whether the address has an account is never said: the page is the same either way.
        if (!(await mayMail(address, ip))) return checkMail();
        let visitor = await byEmail(address);
        if (visitor?.confirmedAt || visitor?.invited) return checkMail();
        const id = visitor?.id ?? crypto.randomUUID();
        if (!visitor) {
          await db.run('INSERT INTO visitors (id, email, name, password, language, created_at, confirmed_at, last_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)', [id, address, typed.name, '', language, new Date().toISOString()]);
          visitor = await byId(id);
        }
        // The password, the name and the language go with the link: whoever opens it, from that mailbox, takes the account as they asked for it.
        const data = { password: await Bun.password.hash(chosen, { algorithm: 'argon2id' }), name: typed.name, language };
        await enqueue(address, 'confirm', language, { name: typed.name, link: linkUrl(await makeLink('confirm', id, data)) });
        return checkMail();
      }
      case '/_/account/forgot': {
        const hint = `<p class="lead">${escape(said.accountForgotHint)}</p>`;
        const forgotForm = (notice?: Notice): Response => draw(said.accountForgot, hint + form('/forgot', email(), said.accountForgotSend) + `<p>${linkTo('', said.accountSignIn)}</p>`, notice);
        if (!(await mailReady())) return draw(said.accountForgot, `<p class="lead">${escape(said.accountNoMail)}</p>`, undefined, 503);
        if (!post) return forgotForm();
        const address = cleanEmail(field('email', 300));
        const visitor = address ? await byEmail(address) : null;
        if (visitor?.confirmedAt && (await mayMail(address, ip))) await enqueue(address, 'reset', visitor.language, { name: visitor.name, link: linkUrl(await makeLink('reset', visitor.id)) });
        return draw(said.accountForgot, `<p class="lead" data-account-forgot-sent>${escape(said.accountForgotSent)}</p><p>${linkTo('', said.accountSignIn)}</p>`);
      }
      case '/_/account/link': {
        const k = (url.searchParams.get('k') ?? field('k', 100)).slice(0, 100);
        const found = await link(k);
        const gone = (): Response => draw(said.accountLinkGone, `<p>${linkTo('', said.accountSignIn)}</p>`, undefined, 410);
        if (!found) return gone();
        const hidden = { k, ...(language === site.language ? {} : { l: language }) };
        if (found.kind === 'confirm' || found.kind === 'email') {
          if (!post) return draw(said.accountConfirm, `<p class="lead">${escape(said.accountConfirmHint)}</p>` + form('/link', '', said.accountConfirmButton, hidden));
          const spent = await link(k, true);
          if (!spent) return gone();
          const { visitor, data } = spent;
          if (spent.kind === 'email') {
            const address = cleanEmail(String(data.email ?? ''));
            if (!address || (await byEmail(address))) return gone();
            await db.run('UPDATE visitors SET email = ? WHERE id = ?', [address, visitor.id]);
            return to('/_/account', 'saved');
          }
          if (visitor.confirmedAt) return gone();
          const kept = { name: String(data.name ?? visitor.name).slice(0, 120), language: String(data.language ?? visitor.language).slice(0, 20) };
          await db.run('UPDATE visitors SET password = ?, name = ?, language = ?, confirmed_at = ? WHERE id = ?', [String(data.password ?? ''), kept.name, kept.language, new Date().toISOString(), visitor.id]);
          await db.run("DELETE FROM visitor_links WHERE visitor_id = ? AND kind = 'confirm'", [visitor.id]);
          await welcomed(visitor.id);
          await enqueue(visitor.email, 'welcome', kept.language, { name: kept.name, link: `${base}/_/account` });
          return signIn(visitor, '', 'confirmed');
        }
        const isInvite = found.kind === 'invite';
        const title = isInvite ? said.accountJoin : said.accountChoosePassword;
        const choose = (notice?: Notice, status = 200): Response =>
          draw(
            title,
            (isInvite ? `<p class="lead">${escape(said.accountJoinHint)}</p>` : '') +
              form('/link', (isInvite ? name(found.visitor.name) : '') + password(said.accountNewPassword, 'new-password') + (isInvite ? consent(settings.privacy) : ''), isInvite ? said.accountMake : said.accountChoosePassword, hidden),
            notice,
            status,
          );
        if (!post) return choose();
        const chosen = field('password', PASSWORD_MAX + 1);
        const named = field('name', 120).trim();
        const weak = passwordProblem(chosen);
        if (weak) return choose({ text: weak, failed: true }, 400);
        if (isInvite && (!named || fields.get('consent') !== 'yes')) return choose({ text: said.accountInvalid, failed: true }, 400);
        const spent = await link(k, true);
        if (!spent) return gone();
        const hash = await Bun.password.hash(chosen, { algorithm: 'argon2id' });
        await db.run('DELETE FROM visitor_sessions WHERE visitor_id = ?', [spent.visitor.id]);
        if (isInvite) {
          await db.run('UPDATE visitors SET password = ?, name = ?, language = ?, confirmed_at = ? WHERE id = ?', [hash, named, language, new Date().toISOString(), spent.visitor.id]);
          await welcomed(spent.visitor.id);
          await enqueue(spent.visitor.email, 'welcome', language, { name: named, link: `${base}/_/account` });
        } else await db.run('UPDATE visitors SET password = ? WHERE id = ?', [hash, spent.visitor.id]);
        await shared.del(`visitor-tries:${hashed(spent.visitor.email)}`);
        return signIn(spent.visitor, '', isInvite ? 'confirmed' : 'password');
      }
      case '/_/account/data': {
        if (!me) return to('/_/account');
        const { password: _hidden, invited: _invited, ...mine } = me;
        return new Response(JSON.stringify(mine, null, 2), {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'content-disposition': 'attachment; filename="my-account.json"' },
        });
      }
      case '/_/account/profile': {
        if (!me || !post) return to('/_/account');
        const named = field('name', 120).trim();
        const address = cleanEmail(field('email', 300));
        if (!named || !address) return accountPage(me, { text: said.accountInvalid, failed: true }, 400);
        await db.run('UPDATE visitors SET name = ? WHERE id = ?', [named, me.id]);
        if (address === me.email) return to('/_/account', 'saved');
        // A new address is confirmed by a link sent to it; whether another account has it is never said.
        if (!(await mailReady())) return accountPage({ ...me, name: named }, { text: said.accountNoMail, failed: true }, 503);
        if (!(await byEmail(address)) && (await mayMail(address, ip))) await enqueue(address, 'confirm', me.language, { name: named, link: linkUrl(await makeLink('email', me.id, { email: address })) });
        return accountPage({ ...me, name: named }, { text: said.accountEmailSent.replace('{email}', address) });
      }
      case '/_/account/password': {
        if (!me || !post) return to('/_/account');
        if (await tooMany(me.email)) return accountPage(me, { text: said.accountTooMany, failed: true }, 429);
        if (!(await checkHash(field('current', PASSWORD_MAX + 1), me.password))) {
          await failed(me.email);
          return accountPage(me, { text: said.accountWrong, failed: true }, 401);
        }
        const chosen = field('password', PASSWORD_MAX + 1);
        const weak = passwordProblem(chosen);
        if (weak) return accountPage(me, { text: weak, failed: true }, 400);
        await db.run('UPDATE visitors SET password = ? WHERE id = ?', [await Bun.password.hash(chosen, { algorithm: 'argon2id' }), me.id]);
        // Signed out everywhere else; signed in here again.
        await db.run('DELETE FROM visitor_sessions WHERE visitor_id = ?', [me.id]);
        return to('/_/account', 'password', { 'set-cookie': cookie(secure, await startSession(me.id), SESSION_DAYS * 86_400) });
      }
      case '/_/account/delete': {
        if (!me || !post) return to('/_/account');
        if (await tooMany(me.email)) return accountPage(me, { text: said.accountTooMany, failed: true }, 429);
        if (!(await checkHash(field('current', PASSWORD_MAX + 1), me.password))) {
          await failed(me.email);
          return accountPage(me, { text: said.accountWrong, failed: true }, 401);
        }
        await enqueue(me.email, 'deleted', me.language, { name: me.name, link: '' });
        await remove(me.id);
        return to('/_/account', 'deleted', { 'set-cookie': cookie(secure, '', 0) });
      }
      case '/_/account/signout': {
        if (!post) return to('/_/account');
        if (secret) await db.run('DELETE FROM visitor_sessions WHERE id = ?', [hashed(secret)]);
        return to('/_/account', 'out', { 'set-cookie': cookie(secure, '', 0) });
      }
      default:
        return plain('not found', 404);
    }
  }

  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

  /** Settings → Visitor accounts: who has an account, inviting, their data, removing, and what could not be sent. */
  const listed = async (settings?: VisitorSettings) => ({
    settings: settings ?? normalizeVisitorSettings(await store.visitorSettings()),
    mail: (await siteMailer(store, deps.mail)) !== null,
    visitors: await (async () => {
      const held = new Map<string, string[]>();
      for (const r of await db.rows<Row>('SELECT visitor_id, level FROM visitor_levels ORDER BY level')) held.set(String(r.visitor_id), [...(held.get(String(r.visitor_id)) ?? []), String(r.level)]);
      return (await db.rows<Row>('SELECT * FROM visitors ORDER BY created_at DESC, email')).map((r) => ({ ...asVisitor(r), levels: held.get(String(r.id)) ?? [] }));
    })(),
    waiting: await mails.waiting(),
    failed: await mails.failed(),
  });

  async function admin(request: Request, url: URL, _me: User, body: Record<string, unknown>): Promise<Response> {
    const route = `${request.method} ${url.pathname}`;
    const id = url.searchParams.get('id') ?? String(body.id ?? '');
    switch (route) {
      case 'GET /api/visitors':
        return json(await listed());
      case 'PUT /api/visitors': {
        // A level the owner took away is taken from everyone who held it.
        const known = normalizeVisitorSettings(await store.visitorSettings()).levels.map((l) => l.id);
        const gone = known.length ? `WHERE level NOT IN (${known.map(() => '?').join(', ')})` : '';
        const held = new Set((await db.rows<Row>(`SELECT DISTINCT visitor_id FROM visitor_levels ${gone}`, known)).map((r) => String(r.visitor_id)));
        const before = new Map<string, string[]>();
        for (const visitorId of held) before.set(visitorId, await levelsOf(visitorId));
        await db.run(`DELETE FROM visitor_levels ${gone}`, known);
        // Each member who lost a level is told of, as when the owner takes it from them (ADR 0064 d7).
        for (const [visitorId, had] of before) await changed(visitorId, had, await levelsOf(visitorId));
        return json(await listed());
      }
      case 'PUT /api/visitors/levels': {
        // The owner gives and takes a visitor's levels (ADR 0064 d3).
        const visitor = await byId(id);
        if (!visitor) return json({ error: 'nobody has that account' }, 404);
        await setLevels(visitor.id, Array.isArray(body.levels) ? body.levels.map(String) : []);
        return json(await listed());
      }
      case 'POST /api/visitors': {
        // An invitation (ADR 0064 d2): the owner gives the address, the visitor chooses the rest from the link.
        const address = cleanEmail(String(body.email ?? ''));
        if (!address) return json({ error: 'that is not an email address' }, 400);
        if (await byEmail(address)) return json({ error: 'someone already has an account with that address' }, 409);
        if ((await siteMailer(store, deps.mail)) === null) return json({ error: 'an invitation is sent by e-mail: set a mail server in Settings → E-mail first' }, 409);
        const site = await siteOf();
        const language = [site.language, ...site.languages].includes(String(body.language ?? '')) ? String(body.language) : site.language;
        const visitorId = crypto.randomUUID();
        await db.run('INSERT INTO visitors (id, email, name, password, language, created_at, confirmed_at, last_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)', [visitorId, address, String(body.name ?? '').trim().slice(0, 120), '', language, new Date().toISOString()]);
        const secret = await makeLink('invite', visitorId);
        const linkUrl = `${baseOf(site, url)}/_/account/link?k=${secret}${language === site.language ? '' : `&l=${encodeURIComponent(language)}`}`;
        await enqueue(address, 'invite', language, { name: '', link: linkUrl });
        return json(await listed());
      }
      case 'DELETE /api/visitors': {
        const visitor = await byId(id);
        if (!visitor) return json({ error: 'nobody has that account' }, 404);
        if (visitor.confirmedAt) await enqueue(visitor.email, 'deleted', visitor.language, { name: visitor.name, link: '' });
        await remove(visitor.id);
        return json(await listed());
      }
      case 'GET /api/visitors/data': {
        // What a visitor may download themselves, for the owner to give them (ADR 0064 d6).
        const visitor = await byId(id);
        if (!visitor) return json({ error: 'nobody has that account' }, 404);
        const { password: _hidden, invited: _invited, ...data } = visitor;
        return json({ visitor: data, language: languageName(visitor.language) });
      }
      case 'POST /api/visitors/retry':
        await mails.retry(id);
        return json(await listed());
      case 'DELETE /api/visitors/failed':
        await mails.drop(id);
        return json(await listed());
      default:
        return json({ error: 'not found' }, 404);
    }
  }

  /** A page for visitors signed in, or for members (ADR 0064 d4): null when this visitor may see it. */
  async function guard(request: Request, url: URL, audience: Audience, asked: string): Promise<Response | null> {
    const me = await sessionVisitor(cookieOf(request));
    if (me && mayView(audience, me.levels)) return null;
    const site = await siteOf();
    const settings = normalizeVisitorSettings(await store.visitorSettings());
    const language = languageOf(site, asked, null);
    const query = language === site.language ? '' : `?l=${encodeURIComponent(language)}`;
    const { said, form, email, password, link: linkTo } = parts(language, query);
    const frame = await deps.frame(language);
    if (frame === null) return plain('nothing is published yet', 404);
    let inside: string;
    if (me) inside = `<p class="lead" data-members-level>${escape(said.membersLevel)}</p><p>${linkTo('', said.myAccount)}</p>`;
    else {
      const back = backOf(url.pathname) || '/';
      const signupLink = settings.signup === 'open' ? `<p>${escape(said.accountNoAccount)} ${linkTo('/signup', said.accountSignUp)}</p>` : '';
      inside =
        `<p class="lead" data-members-sign-in>${escape(audience.who === 'signed' ? said.membersSigned : said.membersSignIn)}</p>` +
        form('/signin', email('', 'username') + password(said.accountPassword, 'current-password'), said.accountSignIn, { back }) +
        `<p>${linkTo('/forgot', said.accountForgot)}</p>${signupLink}`;
    }
    return page(framed(frame, said.members, inside), 403);
  }

  /** A member as an extension reads them (ADR 0064 d7): only an account whose address is confirmed. */
  const member = (visitor: (Visitor & { password: string }) | null) =>
    visitor?.confirmedAt ? { id: visitor.id, name: visitor.name, email: visitor.email, language: visitor.language, levels: visitor.levels } : null;
  const confirmed = async (id: unknown): Promise<Visitor & { password: string }> => {
    const visitor = typeof id === 'string' && id.length <= 100 ? await byId(id) : null;
    if (!visitor?.confirmedAt) throw new Error('no member has that id');
    return visitor;
  };
  const named = async (level: unknown): Promise<string> => {
    const found = normalizeVisitorSettings(await store.visitorSettings()).levels.find((l) => l.id === level);
    if (!found) throw new Error(`"${String(level).slice(0, 40)}" is not one of the levels the owner named`);
    return found.id;
  };

  /** What extensions are lent (ADR 0064 d7), each call checked here as well as by the host. */
  const lent: AccountsLent = {
    get: async (id) => member(typeof id === 'string' && id.length <= 100 ? await byId(id) : null),
    find: async (email) => member(cleanEmail(String(email).slice(0, 300)) ? await byEmail(cleanEmail(String(email).slice(0, 300))) : null),
    levels: async () => normalizeVisitorSettings(await store.visitorSettings()).levels,
    give: async (id, level) => {
      const visitor = await confirmed(id);
      return setLevels(visitor.id, [...visitor.levels, await named(level)]);
    },
    take: async (id, level) => {
      const visitor = await confirmed(id);
      const taken = await named(level);
      return setLevels(visitor.id, visitor.levels.filter((l) => l !== taken));
    },
    send: async (id, mail, link) => {
      const visitor = await confirmed(id);
      // Enough for what a visitor needs to hear from a site; too few to fill their mailbox.
      if ((await shared.hit(`visitor-mail-lent:${visitor.id}`, HOUR)) > LENT_MAILS_PER_VISITOR) throw new Error(`a visitor is sent at most ${LENT_MAILS_PER_VISITOR} messages an hour by extensions`);
      const site = await siteOf();
      if (mail === 'welcome') return enqueue(visitor.email, 'welcome', visitor.language, { name: visitor.name, link });
      const words = mail.words(visitor.language);
      const values: Record<string, string> = { name: visitor.name, link, site: site.name };
      const fill = (text: string): string => text.replace(/\{(name|link|site)\}/g, (_whole, key: string) => values[key] as string);
      await queue(visitor.email, mail.what, { subject: fill(words.subject).replace(/[\r\n]+/g, ' ').slice(0, 300), text: fill(words.text) });
    },
    visitor: async (request) => {
      const me = await sessionVisitor(cookieOf(request));
      return me ? { id: me.id, levels: me.levels } : null;
    },
  };

  return { fetch, chores, admin, guard, lent };
}
