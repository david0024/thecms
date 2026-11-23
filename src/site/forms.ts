/**
 * The site's form service (ADR 0019). The site stays static files; this small
 * server is the one place a visitor's words are sent to. It takes a message
 * from a form on a published page, keeps it with the consent the visitor
 * ticked, tells the owner by email, and sends the visitor back to the page,
 * where the stylesheet shows that it was sent. No script anywhere.
 *
 * It answers only what a form of this site sends: a form that is not on a
 * published page, a page of another site, or a robot that fills the hidden
 * field gets nothing kept.
 *
 * Each form is built on the Forms screen (ADR 0049); what a visitor sends is
 * checked field by field as the form says, and kept field by field.
 *
 * It takes comments the same way (ADR 0040): one on a published entry of a
 * type that takes them is kept until the owner approves it.
 */
import { answersText, type Block, checkAnswers, contentTypes, entryIn, entryPath, typeIn, formBlocks, formIn, prefixOf, type Site } from '../core/index.ts';
import { wordsFor } from '../blocks/words.ts';
import { isEmail, type Mailer } from './mail.ts';
import { localShared, type Shared } from './shared.ts';
import type { Store } from './store.ts';
import './languages.ts';

export interface FormsServer {
  url: string;
  port: number;
  fetch: (request: Request, ip?: string) => Promise<Response>;
  stop: () => void;
}

const MAX_BYTES = 16 * 1024;
/** Messages one visitor may send in a window: enough for a person, too few for a flood. */
const PER_VISITOR = 5;
const WINDOW_MS = 10 * 60 * 1000;
const FORM_ID = /^[A-Za-z0-9_-]{1,60}$/;
/** A comment is a few paragraphs, not an article. */
export const MAX_COMMENT = 3000;

/** The form each form block on a published page names, by the block's id: a page, an entry, a type's page or a section. */
async function publishedForms(store: Store): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const walk = (blocks: Block[]): void => {
    for (const { block, form } of formBlocks(blocks)) found.set(block.id, form);
  };
  for (const page of await store.published()) walk(page.blocks);
  for (const type of contentTypes(await store.site())) {
    for (const entry of await store.publishedEntries(type.id)) walk(entry.blocks);
    walk((await store.publishedTemplate(type.id)) ?? []);
  }
  // A form in a section is on every page that shows it (ADR 0033), in each language.
  for (const section of await store.publishedSections()) {
    walk(section.blocks);
    for (const translation of Object.values(section.translations ?? {})) walk(translation.blocks ?? []);
  }
  return found;
}

/** The language of the page a form was sent from, by its address: what the consent was shown in. */
function languageAt(site: Site, back: string): string {
  const first = back.split('/')[1] ?? '';
  return site.languages.find((l) => prefixOf(l) === first) ?? site.language;
}

export function startForms(
  store: Store,
  options: {
    port?: number;
    listen?: boolean;
    hostname?: string;
    mailer?: Mailer | null;
    to?: string;
    from?: string;
    log?: (line: string) => void;
    shared?: Shared;
    /** Asks the extensions that answer a question, and waits for them (ADR 0062 d3). */
    ask?: (question: 'comment.check', input: Record<string, unknown>) => Promise<string[]>;
  } = {},
): FormsServer {
  const log = options.log ?? ((line: string) => console.error(line));
  // What a visitor sent is counted where the site's processes share it (ADR 0044 d4).
  const shared = options.shared ?? localShared();
  const tooMany = async (ip: string): Promise<boolean> => (await shared.hit(`sent:${ip}`, WINDOW_MS)) > PER_VISITOR;

  async function handle(request: Request, ip = ''): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return new Response('uhlaka forms\n', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname !== '/send' && url.pathname !== '/comment') return new Response('not found\n', { status: 404 });
    if (request.method !== 'POST') return new Response('a form is sent with POST\n', { status: 405, headers: { allow: 'POST' } });
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return new Response('too large\n', { status: 413 });

    const site = await store.site();
    const home = site.url ? new URL(site.url).origin : '';
    // A browser says which page a form came from. One from another site is not this site's visitor.
    const origin = request.headers.get('origin');
    if (home && origin && origin !== 'null' && origin !== home) return new Response('not a form of this site\n', { status: 403 });

    const text = await request.text();
    if (text.length > MAX_BYTES) return new Response('too large\n', { status: 413 });
    const fields = new URLSearchParams(text);
    const field = (name: string): string => (fields.get(name) ?? '').trim();
    const back = /^\/(?!\/)[^\s\\#?]*$/.test(field('back')) ? field('back') : '/';
    if (url.pathname === '/comment') return comment(fields, site, home, back, ip);
    const form = FORM_ID.test(field('form')) ? field('form') : '';
    const answer = (ok: boolean): Response => sentBack(home, back, `f-${form}`, ok);

    // The hidden field: a person never fills it. The robot is told it worked, and nothing is kept.
    if (field('website')) return answer(true);
    const name = form ? (await publishedForms(store)).get(form) : undefined;
    const kept = name ? (await store.forms()).find((f) => f.name === name) : undefined;
    if (!kept || field('consent') !== 'yes') return answer(false);
    // Each field as the form says (ADR 0049 d4): one that fails is not kept.
    const checked = checkAnswers(kept, (n) => fields.getAll(n));
    if (!('answers' in checked)) return answer(false);
    if (await tooMany(ip || 'unknown')) return answer(false);

    const answers = checked.answers;
    // The name and the address to answer, when the form asks for them: the field so called, or the first of its kind.
    const pick = (id: string, kind: string): string =>
      (answers.find((a) => a.id === id && a.value) ?? answers.find((a) => kept.fields.find((f) => f.id === a.id)?.kind === kind && a.value))?.value ?? '';
    const from = pick('name', 'text');
    const email = pick('email', 'email');
    const body = answersText(answers);
    const consent = formIn(kept, languageAt(site, back)).consent;
    await store.forgetOldMessages();
    const message = await store.addMessage({ form: kept.name, page: back, name: from, email, body, consent, answers });
    const who = from ? (email ? `${from} <${email}>` : from) : email || 'A visitor';
    tell(message.id, { ...(email ? { replyTo: email } : {}), subject: `${site.name}: ${kept.title}${from ? `, from ${from}` : ''}`, text: `${who} wrote, through the form "${kept.title}" on ${site.url}${back}:\n\n${body}\n` });
    return answer(true);
  }

  /** Back to the page the visitor wrote on, where the stylesheet shows whether it was sent. */
  function sentBack(home: string, back: string, note: string, ok: boolean): Response {
    if (!home) return new Response(ok ? 'Sent.\n' : 'Not sent.\n', { status: ok ? 200 : 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response(null, { status: 303, headers: { location: `${home}${back}#${note}-${ok ? 'sent' : 'failed'}` } });
  }

  /** Tells the owner by email, when the site has a way to send one. What was sent is kept either way. */
  function tell(id: string, mail: { replyTo?: string; subject: string; text: string }): void {
    if (!options.mailer || !options.to) return;
    options
      .mailer({ from: options.from || options.to, to: options.to, ...mail })
      .catch((error: unknown) => log(`What was sent (${id}) was kept, but the email about it was not sent: ${error instanceof Error ? error.message : String(error)}`));
  }

  /** A comment on an entry (ADR 0040): kept only for a published entry of a type that takes comments, and shown once approved. */
  async function comment(fields: URLSearchParams, site: Site, home: string, back: string, ip: string): Promise<Response> {
    const field = (name: string): string => (fields.get(name) ?? '').trim();
    const type = contentTypes(site).find((t) => t.id === field('type') && t.comments);
    const slug = field('entry');
    const main = type && slug ? (await store.publishedEntries(type.id)).find((post) => post.slug === slug) : undefined;
    // Written under the entry in another language: kept with that language, and found there (ADR 0054 d6).
    const language = site.languages.includes(field('language')) && main?.translations?.[field('language')] ? field('language') : '';
    const entry = type && main && language ? entryIn(site, type, main, language) : main;
    // Back to the entry itself, wherever the form said it was.
    const at = type && entry ? entryPath(typeIn(site, type, language || site.language), entry.slug) : back;
    const answer = (ok: boolean): Response => sentBack(home, at, 'comment', ok);
    if (field('website')) return answer(true);
    const name = field('name');
    const email = field('email');
    const body = field('comment');
    if (!type || !entry || !name || name.length > 120 || !isEmail(email) || !body || body.length > MAX_COMMENT || field('consent') !== 'yes') return answer(false);
    if (await tooMany(ip || 'unknown')) return answer(false);

    await store.forgetOldMessages();
    // Checked first by the extensions that answer it (ADR 0062 d3), never with the writer's address: the strictest answer wins.
    const answers = options.ask ? await options.ask('comment.check', { name, words: body, language: language || site.language, entry: at, title: entry.title }) : [];
    const judged = answers.includes('spam') ? 'spam' : answers.includes('hold') ? 'hold' : answers.includes('approve') ? 'approve' : null;
    const kept = await store.addComment({ type: type.id, entry: slug, name, email, body, consent: wordsFor(language || site.language).commentConsent, ...(language ? { language } : {}) }, new Date(), judged);
    // Spam is kept apart and not told: the owner finds it under Spam.
    if (kept.spam) return answer(true);
    const state = kept.approved ? (judged === 'approve' ? 'It is shown already: an extension that checks comments approved it.' : 'It is shown already: an earlier comment from this address was approved.') : 'It waits for your approval, under Comments in the admin.';
    tell(kept.id, { replyTo: email, subject: `${site.name}: a comment from ${name}`, text: `${name} <${email}> commented on "${entry.title}", ${site.url}${at}:\n\n${body}\n\n${state}\n` });
    return answer(true);
  }

  let port = options.port ?? 4322;
  const server =
    options.listen === false
      ? null
      : Bun.serve({
          hostname: options.hostname ?? '127.0.0.1',
          port,
          maxRequestBodySize: MAX_BYTES,
          fetch: (request, srv) => handle(request, request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || srv.requestIP(request)?.address || ''),
        });
  if (server?.port) port = server.port;
  return { url: `http://${options.hostname ?? '127.0.0.1'}:${port}`, port, fetch: handle, stop: () => server?.stop(true) };
}
