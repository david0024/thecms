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
 */
import { type Block, contentTypes } from '../core/index.ts';
import { isEmail, type Mailer } from './mail.ts';
import type { Store } from './store.ts';

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

/** The consent words of every form on a published page, page, entry or a type's page, by the form's id. */
async function publishedForms(store: Store): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const walk = (blocks: Block[]): void => {
    for (const block of blocks) {
      if (block.type === 'form') found.set(block.id, String(block.content.consent ?? ''));
      if (block.children) walk(block.children);
    }
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

export function startForms(
  store: Store,
  options: { port?: number; listen?: boolean; hostname?: string; mailer?: Mailer | null; to?: string; from?: string; log?: (line: string) => void } = {},
): FormsServer {
  const log = options.log ?? ((line: string) => console.error(line));
  const sent = new Map<string, number[]>();
  const tooMany = (ip: string, now: number): boolean => {
    const recent = (sent.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
    sent.set(ip, recent);
    if (recent.length >= PER_VISITOR) return true;
    recent.push(now);
    return false;
  };

  async function handle(request: Request, ip = ''): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return new Response('thecms forms\n', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname !== '/send') return new Response('not found\n', { status: 404 });
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
    const form = FORM_ID.test(field('form')) ? field('form') : '';
    const answer = (ok: boolean): Response => {
      if (!home) return new Response(ok ? 'Sent.\n' : 'Not sent.\n', { status: ok ? 200 : 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      return new Response(null, { status: 303, headers: { location: `${home}${back}#f-${form}-${ok ? 'sent' : 'failed'}` } });
    };

    // The hidden field: a person never fills it. The robot is told it worked, and nothing is kept.
    if (field('website')) return answer(true);
    const consent = form ? (await publishedForms(store)).get(form) : undefined;
    const name = field('name');
    const email = field('email');
    const body = field('message');
    if (consent === undefined || !name || name.length > 120 || !isEmail(email) || !body || body.length > 5000 || field('consent') !== 'yes') return answer(false);
    if (tooMany(ip || 'unknown', Date.now())) return answer(false);

    await store.forgetOldMessages();
    const message = await store.addMessage({ form, page: back, name, email, body, consent });
    if (options.mailer && options.to) {
      const from = options.from || options.to;
      options
        .mailer({ from, to: options.to, replyTo: email, subject: `${site.name}: a message from ${name}`, text: `${name} <${email}> wrote, on ${site.url}${back}:\n\n${body}\n` })
        .catch((error: unknown) => log(`The message ${message.id} was kept, but the email about it was not sent: ${error instanceof Error ? error.message : String(error)}`));
    }
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
