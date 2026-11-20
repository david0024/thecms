/**
 * Comments with moderation (ADR 0040): a type may take them; a visitor writes
 * one with a plain form under an entry; it waits for the owner, who approves
 * or deletes it; what is approved is drawn under the entry, without the
 * writer's address. A visitor's right to see or erase covers comments too.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeTypes, postsType } from '../src/core/index.ts';
import { publishedSite } from '../src/site/export.ts';
import { MAX_COMMENT, startForms } from '../src/site/forms.ts';
import type { Mail } from '../src/site/mail.ts';
import { FRESH_MS, startRuntime } from '../src/site/runtime.ts';
import { startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const dir = await mkdtemp(join(tmpdir(), 'thecms-comments-'));
afterAll(() => rm(dir, { recursive: true, force: true }));
const SITE = 'https://example.com';

/** A site with a blog that takes comments, one published post and one draft. */
async function site(name: string, forms = 'https://forms.example.com'): Promise<Store> {
  const store = await Store.open(join(dir, `${name}.db`));
  await store.setTheme(plain);
  await store.publishTheme();
  await store.setSite({ name: 'Atelier', url: SITE, forms, types: [{ ...postsType(), comments: true }] });
  await store.savePage({ slug: '', title: 'Home', blocks: [] });
  await store.publish('');
  await store.savePost({ slug: 'oak', title: 'On oak', date: '2026-11-01', blocks: [] });
  await store.publishPost('oak');
  await store.savePost({ slug: 'draft', title: 'Not yet', date: '2026-11-02', blocks: [] });
  return store;
}

const post = (fields: Record<string, string>, origin = SITE) =>
  new Request('http://forms.local/comment', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin }, body: new URLSearchParams(fields).toString() });
const good = (more: Record<string, string> = {}): Record<string, string> => ({
  back: '/blog/oak/',
  type: 'posts',
  entry: 'oak',
  name: 'Ana Pop',
  email: 'ana@example.org',
  comment: 'Lovely grain.\nWhich finish?',
  consent: 'yes',
  website: '',
  ...more,
});

describe('a type that takes comments', () => {
  test('says so, and only when it is asked', () => {
    const [on, off] = normalizeTypes([
      { name: 'Notes', comments: true },
      { name: 'Projects', comments: 'yes' },
    ]);
    expect(on?.comments).toBe(true);
    expect(off && 'comments' in off).toBe(false);
  });
});

describe('a comment', () => {
  test('is kept waiting, the owner is told, and nothing is shown until it is approved', async () => {
    const store = await site('flow');
    const mails: Mail[] = [];
    const forms = startForms(store, { listen: false, mailer: async (mail) => void mails.push(mail), to: 'owner@example.com', log: () => {} });
    try {
      const sent = await forms.fetch(post(good({ back: '/elsewhere/' })), '1.1.1.1');
      expect([sent.status, sent.headers.get('location')]).toEqual([303, `${SITE}/blog/oak/#comment-sent`]);
      const [kept] = await store.comments();
      expect(kept).toMatchObject({ type: 'posts', entry: 'oak', name: 'Ana Pop', email: 'ana@example.org', body: 'Lovely grain.\nWhich finish?', approved: false });
      expect(kept?.consent).toContain('never shown');
      await Bun.sleep(1);
      expect(mails[0]).toMatchObject({ to: 'owner@example.com', replyTo: 'ana@example.org', subject: 'Atelier: a comment from Ana Pop' });
      expect(mails[0]?.text).toContain('waits for your approval');

      let html = String((await publishedSite(store)).get('blog/oak/index.html'));
      expect(html).toContain('action="https://forms.example.com/comment"');
      expect(html).toContain('<input type="hidden" name="entry" value="oak"');
      expect(html).toContain('id="comment-sent"');
      expect(html).not.toContain('Lovely grain');
      expect(html.slice(html.indexOf('<main'))).not.toContain('<script');

      await store.approveComment(kept?.id ?? '');
      html = String((await publishedSite(store)).get('blog/oak/index.html'));
      expect(html).toContain('Lovely grain.');
      expect(html).toContain('<strong>Ana Pop</strong>');
      expect(html).toContain(`id="comment-${kept?.id}"`);
      expect(html).not.toContain('ana@example.org');

      // Someone the owner already let speak is shown at once.
      await forms.fetch(post(good({ comment: 'Thank you!', email: 'ANA@example.org' })), '1.1.1.1');
      expect((await store.comments()).map((c) => [c.body, c.approved])).toEqual([
        ['Thank you!', true],
        ['Lovely grain.\nWhich finish?', true],
      ]);
      await Bun.sleep(1);
      expect(mails[1]?.text).toContain('shown already');
      expect(Object.values(await store.shownComments()).flat().map((c) => c.body)).toEqual(['Lovely grain.\nWhich finish?', 'Thank you!']);
    } finally {
      await store.close();
    }
  });

  test('is refused on what does not take one, or when it is not whole', async () => {
    const store = await site('refused');
    let failed = '';
    const forms = startForms(store, {
      listen: false,
      mailer: async () => {
        throw new Error('down');
      },
      to: 'owner@example.com',
      log: (line) => (failed = line),
    });
    try {
      const where = async (fields: Record<string, string>) => (await forms.fetch(post(fields), '2.2.2.2')).headers.get('location');
      expect(await where(good({ entry: 'draft' }))).toBe(`${SITE}/blog/oak/#comment-failed`);
      expect(await where(good({ type: 'nothing' }))).toBe(`${SITE}/blog/oak/#comment-failed`);
      expect(await where(good({ consent: '' }))).toBe(`${SITE}/blog/oak/#comment-failed`);
      expect(await where(good({ comment: 'x'.repeat(MAX_COMMENT + 1) }))).toBe(`${SITE}/blog/oak/#comment-failed`);
      expect(await where(good({ email: 'not an address' }))).toBe(`${SITE}/blog/oak/#comment-failed`);
      // The robot is told it worked, and nothing is kept.
      expect(await where(good({ website: 'spam.example' }))).toBe(`${SITE}/blog/oak/#comment-sent`);
      expect(await store.comments()).toEqual([]);
      // One from another site is not this site's visitor.
      expect((await forms.fetch(post(good(), 'https://evil.example'), '2.2.2.2')).status).toBe(403);

      // A type that does not take comments is not commented on, even through its own form.
      await store.setSite({ name: 'Atelier', url: SITE, forms: 'https://forms.example.com', types: [postsType()] });
      expect(await where(good())).toBe(`${SITE}/blog/oak/#comment-failed`);
      expect(String((await publishedSite(store)).get('blog/oak/index.html'))).not.toContain('comment');

      // A kept comment whose email could not be sent is still kept, and the owner's log says so.
      await store.setSite({ name: 'Atelier', url: SITE, forms: 'https://forms.example.com', types: [{ ...postsType(), comments: true }] });
      expect(await where(good())).toBe(`${SITE}/blog/oak/#comment-sent`);
      await Bun.sleep(1);
      expect(failed).toContain('the email about it was not sent: down');
      // Five a visitor may send; the sixth waits.
      for (let i = 0; i < 4; i++) await where(good());
      expect(await where(good())).toBe(`${SITE}/blog/oak/#comment-failed`);
    } finally {
      await store.close();
    }
  });

  test('without a site address, the visitor is told in a line', async () => {
    const store = await site('bare');
    await store.setSite({ name: 'Atelier', forms: 'https://forms.example.com', types: [{ ...postsType(), comments: true }] });
    const forms = startForms(store, { listen: false, log: () => {} });
    try {
      const sent = await forms.fetch(post(good()), '3.3.3.3');
      expect([sent.status, await sent.text()]).toEqual([200, 'Sent.\n']);
    } finally {
      await store.close();
    }
  });

  test('without a form service, what was approved is shown and no form is drawn', async () => {
    const store = await site('static', '');
    try {
      expect(String((await publishedSite(store)).get('blog/oak/index.html'))).not.toContain('id="comments"');
      const kept = await store.addComment({ type: 'posts', entry: 'oak', name: 'Ion', email: 'ion@example.org', body: 'Hello', consent: 'ok' });
      await store.approveComment(kept.id);
      const html = String((await publishedSite(store)).get('blog/oak/index.html'));
      expect(html).toContain('id="comments"');
      expect(html).toContain('Hello');
      expect(html).not.toContain('<form');
    } finally {
      await store.close();
    }
  });

  test('goes with its entry, and one nobody approved is forgotten with the messages', async () => {
    const store = await site('gone');
    try {
      const old = await store.addComment({ type: 'posts', entry: 'oak', name: 'A', email: 'a@example.org', body: 'old', consent: 'ok' }, new Date('2020-01-01T00:00:00Z'));
      const kept = await store.addComment({ type: 'posts', entry: 'oak', name: 'A', email: 'a@example.org', body: 'kept', consent: 'ok' }, new Date('2020-01-02T00:00:00Z'));
      await store.approveComment(kept.id);
      await store.forgetOldMessages();
      expect((await store.comments()).map((c) => c.id)).toEqual([kept.id]);
      expect(old.approved).toBe(false);
      await store.deleteEntry('posts', 'oak');
      expect(await store.comments()).toEqual([]);
    } finally {
      await store.close();
    }
  });
});

describe('the runtime', () => {
  test('takes comments at /_/comment, and shows an approved one within FRESH_MS', async () => {
    const store = await site('runtime', '/_');
    let clock = 0;
    const runtime = startRuntime(store, { listen: false, log: () => {}, now: () => clock });
    const get = async (path: string) => (await runtime.fetch(new Request(`http://site.local${path}`), '4.4.4.4')).text();
    try {
      expect(await get('/blog/oak/')).toContain('action="/_/comment"');
      const sent = await runtime.fetch(new Request('http://site.local/_/comment', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: SITE }, body: new URLSearchParams(good()).toString() }), '4.4.4.4');
      expect(sent.headers.get('location')).toBe(`${SITE}/blog/oak/#comment-sent`);
      await store.approveComment((await store.comments())[0]?.id ?? '');
      clock += FRESH_MS;
      expect(await get('/blog/oak/')).toContain('Lovely grain.');
    } finally {
      runtime.stop();
      await store.close();
    }
  });
});

describe('the editor', () => {
  test('lists, approves and deletes comments, and gives or erases a visitor\'s', async () => {
    const store = await site('editor');
    const editor = await startEditor(store, { listen: false });
    const call = async (method: string, path: string) => {
      const response = await editor.fetch(new Request(`http://127.0.0.1:4321${path}`, { method, headers: { host: '127.0.0.1:4321', 'x-thecms-token': editor.token } }));
      return (await response.json()) as Record<string, any>;
    };
    try {
      const first = await store.addComment({ type: 'posts', entry: 'oak', name: 'A', email: 'a@example.org', body: 'one', consent: 'ok' });
      const second = await store.addComment({ type: 'posts', entry: 'oak', name: 'B', email: 'b@example.org', body: 'two', consent: 'ok' });
      expect((await call('GET', '/api/comments')).comments).toHaveLength(2);
      expect((await call('POST', `/api/comments?id=${first.id}`)).comments.find((c: { id: string }) => c.id === first.id).approved).toBe(true);
      expect((await call('DELETE', `/api/comments?id=${second.id}`)).comments.map((c: { id: string }) => c.id)).toEqual([first.id]);

      const given = await call('GET', '/api/messages?email=A@example.org');
      expect([given.messages, given.comments.map((c: { body: string }) => c.body)]).toEqual([[], ['one']]);
      await call('DELETE', '/api/messages?email=a@example.org');
      expect(await store.comments()).toEqual([]);
    } finally {
      editor.stop();
      await store.close();
    }
  });
});
