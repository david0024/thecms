/**
 * The contact form and the site's form service (ADR 0019): the form is plain
 * HTML on a static page; the service keeps what a visitor sent, with the
 * consent they ticked, tells the owner, and sends the visitor back.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Block, cleanFormsAddress, normalizeBlocks, normalizeSite, parseTheme, type Theme } from '../src/core/index.ts';
import { renderPage } from '../src/site/document.ts';
import { startForms } from '../src/site/forms.ts';
import { type Mail, mailText, smtpMailer } from '../src/site/mail.ts';
import { type EditorServer, startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const theme = parseTheme(plain).theme as Theme;
const formBlock = (): Block => normalizeBlocks([{ type: 'form', content: { title: 'Write to us', consent: 'Keep this to answer me.', button: 'Send', sent: 'Sent!', failed: 'Not sent.' } }]).blocks[0] as Block;
const main = (html: string): string => html.slice(html.indexOf('<main'), html.indexOf('</main>'));

describe('the form on the page', () => {
  test('without a form service it is not drawn on the site, and the editor says why', () => {
    const page = { slug: 'contact', title: 'Contact', description: '', inMenu: true, blocks: [formBlock()] };
    expect(main(renderPage(normalizeSite({ name: 'S' }), theme, page, []))).not.toContain('<form');
  });

  test('with one, it is plain HTML that posts there and comes back to this page, in the site\'s language', () => {
    const block = formBlock();
    const site = normalizeSite({ name: 'S', language: 'ro', forms: 'https://forms.example.com/' });
    const html = main(renderPage(site, theme, { slug: 'contact', title: 'Contact', description: '', inMenu: true, blocks: [block] }, []));
    expect(html).toContain('action="https://forms.example.com/send"');
    expect(html).toContain('method="post"');
    expect(html).toContain('<input type="hidden" name="back" value="/contact/"');
    expect(html).toContain(`<input type="hidden" name="form" value="${block.id}"`);
    expect(html).toMatch(/name="consent" type="checkbox" value="yes" required/);
    expect(html).toContain('>Mesaj</label>');
    expect(html).toContain(`id="f-${block.id}-sent"`);
    expect(html).not.toContain('<script');
  });

  test('the service\'s address is https, or http on this machine, and nothing else', () => {
    expect(cleanFormsAddress('https://forms.example.com/')).toBe('https://forms.example.com');
    expect(cleanFormsAddress('https://example.com/forms/')).toBe('https://example.com/forms');
    expect(cleanFormsAddress('http://127.0.0.1:4322')).toBe('http://127.0.0.1:4322');
    for (const bad of ['http://forms.example.com', 'javascript:alert(1)', 'https://u:p@x.example', 'https://x.example/?a=1', '/send', '']) expect(cleanFormsAddress(bad)).toBe('');
  });
});

describe('the form service', () => {
  let dir: string;
  let store: Store;
  let block: Block;
  let mails: Mail[];
  const SITE = 'https://example.com';
  const service = (mailer = async (mail: Mail) => void mails.push(mail)) => startForms(store, { listen: false, mailer, to: 'owner@example.com', log: () => {} });
  const post = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
    new Request('http://forms.local/send', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: SITE, ...headers }, body: new URLSearchParams(fields).toString() });
  const good = (): Record<string, string> => ({ back: '/contact/', form: block.id, name: 'Ana Pop', email: 'ana@example.org', message: 'Hello.\nA table for 12?', consent: 'yes', website: '' });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'thecms-forms-'));
    store = await Store.open(join(dir, 'site.db'));
    await store.setSite({ name: 'Atelier', url: SITE, forms: 'https://forms.example.com' });
    block = formBlock();
    await store.publish((await store.savePage({ slug: 'contact', title: 'Contact', blocks: [block] })).slug);
    mails = [];
  });
  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('a message is kept with the consent the page showed, the owner is told, and the visitor is sent back', async () => {
    const response = await service().fetch(post(good()), '1.2.3.4');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SITE}/contact/#f-${block.id}-sent`);
    const [kept] = await store.messages();
    expect(kept).toMatchObject({ form: block.id, page: '/contact/', name: 'Ana Pop', email: 'ana@example.org', body: 'Hello.\nA table for 12?', consent: 'Keep this to answer me.' });
    await Bun.sleep(1);
    expect(mails).toEqual([expect.objectContaining({ to: 'owner@example.com', replyTo: 'ana@example.org', subject: 'Atelier: a message from Ana Pop' })]);
  });

  test('what is not a person writing through a form of this site is not kept', async () => {
    const forms = service();
    const failed = `${SITE}/contact/#f-${block.id}-failed`;
    expect((await forms.fetch(post({ ...good(), consent: '' }))).headers.get('location')).toBe(failed);
    expect((await forms.fetch(post({ ...good(), email: 'not an address' }))).headers.get('location')).toBe(failed);
    expect((await forms.fetch(post({ ...good(), message: '   ' }))).headers.get('location')).toBe(failed);
    // A form that is on no published page.
    expect((await forms.fetch(post({ ...good(), form: 'b_nowhere' }))).headers.get('location')).toBe(`${SITE}/contact/#f-b_nowhere-failed`);
    // Another site's page.
    expect((await forms.fetch(post(good(), { origin: 'https://evil.example' }))).status).toBe(403);
    // A robot that fills the hidden field is told it worked.
    expect((await forms.fetch(post({ ...good(), website: 'http://spam.example' }))).headers.get('location')).toBe(`${SITE}/contact/#f-${block.id}-sent`);
    // It is only ever sent back to a page of this site.
    expect((await forms.fetch(post({ ...good(), back: '//evil.example/', consent: '' }))).headers.get('location')).toBe(`${SITE}/#f-${block.id}-failed`);
    expect(await store.messages()).toEqual([]);
    expect(mails).toEqual([]);
  });

  test('one visitor sends a few, not a flood; a mail that fails does not lose the message', async () => {
    const forms = service(async () => {
      throw new Error('the mail server is down');
    });
    for (let i = 0; i < 5; i++) expect((await forms.fetch(post(good()), '9.9.9.9')).headers.get('location')).toEndWith('-sent');
    expect((await forms.fetch(post(good()), '9.9.9.9')).headers.get('location')).toEndWith('-failed');
    expect((await forms.fetch(post(good()), '8.8.8.8')).headers.get('location')).toEndWith('-sent');
    expect(await store.messages()).toHaveLength(6);
  });

  test('messages are kept for the days the site says, and a visitor\'s can be found and erased', async () => {
    await store.setSite({ ...(await store.site()), keepMessages: 30 });
    await store.addMessage({ form: block.id, page: '/', name: 'Old', email: 'old@example.org', body: 'x', consent: 'c' }, new Date(Date.now() - 31 * 86_400_000));
    await store.addMessage({ form: block.id, page: '/', name: 'New', email: 'Ana@Example.org', body: 'y', consent: 'c' });
    await store.addMessage({ form: block.id, page: '/', name: 'Again', email: 'ana@example.org', body: 'z', consent: 'c' });
    await store.forgetOldMessages();
    expect((await store.messages()).map((m) => m.name).sort()).toEqual(['Again', 'New']);
    expect(await store.messages('ANA@example.org')).toHaveLength(2);
    expect(await store.deleteMessagesFrom('ana@example.org')).toBe(2);
    expect(await store.messages()).toEqual([]);
  });

  test('the admin reads, deletes and erases them; nobody else can', async () => {
    const editor: EditorServer = await startEditor(store, { listen: false });
    const call = (path: string, method = 'GET', token = editor.token) => editor.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': token } }));
    try {
      const one = await store.addMessage({ form: block.id, page: '/', name: 'A', email: 'a@example.org', body: 'x', consent: 'c' });
      await store.addMessage({ form: block.id, page: '/', name: 'B', email: 'b@example.org', body: 'y', consent: 'c' });
      expect((await call('/api/messages', 'GET', 'wrong')).status).toBe(401);
      expect(((await (await call('/api/messages')).json()) as { messages: unknown[]; keep: number }).keep).toBe(180);
      expect(((await (await call('/api/messages?email=b@example.org')).json()) as { messages: { name: string }[] }).messages.map((m) => m.name)).toEqual(['B']);
      await call(`/api/messages?id=${one.id}`, 'DELETE');
      const left = (await (await call('/api/messages?email=b@example.org', 'DELETE')).json()) as { messages: unknown[] };
      expect(left.messages).toEqual([]);
    } finally {
      editor.stop();
    }
  });
});

describe('telling the owner by email', () => {
  test('a header cannot be split by what a visitor typed, and the text arrives whole', () => {
    const text = mailText({ from: 'site@example.com', to: 'owner@example.com', replyTo: 'x@example.org\r\nBcc: all@example.org', subject: 'Hi\r\nBcc: all@example.org ăîș', text: 'Line one\n.\nȘtiu' }, new Date(0), 'id');
    const [head, body] = text.split('\r\n\r\n') as [string, string];
    expect(head).not.toMatch(/^Bcc:/m);
    expect(head).not.toContain('Reply-To');
    expect(head).toContain('Subject: =?UTF-8?B?');
    const plainSubject = mailText({ from: 'site@example.com', to: 'owner@example.com', subject: 'Hi\r\nBcc: all@example.org', text: 'x' }, new Date(0), 'id');
    expect(plainSubject).toContain('Subject: Hi Bcc: all@example.org\r\n');
    expect(plainSubject).not.toMatch(/^Bcc:/m);
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Line one\r\n.\r\nȘtiu');
  });

  test('through a plain server on this machine, signed in; a plain server elsewhere is refused', async () => {
    const said: string[] = [];
    let data = '';
    let inData = false;
    const server = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        open(socket) {
          socket.write('220 test ready\r\n');
        },
        data(socket, chunk) {
          for (const line of new TextDecoder().decode(chunk).split('\r\n').filter((l, i, all) => l || i < all.length - 1)) {
            if (inData) {
              if (line === '.') {
                inData = false;
                socket.write('250 queued\r\n');
              } else data += `${line}\n`;
              continue;
            }
            said.push(line);
            if (line.startsWith('EHLO')) socket.write('250-test\r\n250 AUTH PLAIN\r\n');
            else if (line.startsWith('AUTH')) socket.write('235 ok\r\n');
            else if (line.startsWith('DATA')) {
              inData = true;
              socket.write('354 go\r\n');
            } else if (line.startsWith('QUIT')) socket.end('221 bye\r\n');
            else socket.write('250 ok\r\n');
          }
        },
      },
    });
    try {
      const mailer = smtpMailer(`smtp://site%40example.com:s3cret@127.0.0.1:${server.port}`);
      await mailer?.({ from: 'site@example.com', to: 'owner@example.com', subject: 'A message', text: 'Hello' });
      expect(said).toContain(`AUTH PLAIN ${Buffer.from('\0site@example.com\0s3cret').toString('base64')}`);
      expect(said).toContain('MAIL FROM:<site@example.com>');
      expect(said).toContain('RCPT TO:<owner@example.com>');
      expect(data).toContain('Subject: A message');
    } finally {
      server.stop(true);
    }
    expect(() => smtpMailer('smtp://mail.example.com')).toThrow('only used on this machine');
    expect(smtpMailer(undefined)).toBeNull();
  });
});
