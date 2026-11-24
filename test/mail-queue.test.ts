/**
 * The queue of mail to visitors (ADR 0064 d5): what is queued together is sent
 * in the order it was queued.
 */
import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMailQueue } from '../src/site/mail-queue.ts';
import { Store } from '../src/site/store.ts';

const dir = await mkdtemp(join(tmpdir(), 'uhlaka-mail-queue-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

test('messages queued in the same moment go out in the order they were queued', async () => {
  const store = await Store.open(join(dir, 'queue.db'));
  try {
    const sent: string[] = [];
    const queue = await openMailQueue(store, { mailer: async (mail) => void sent.push(mail.subject), from: 'site@example.com' }, () => {});
    const subjects = Array.from({ length: 12 }, (_, i) => `message ${i}`);
    // Queued one after the other, most of them in the same millisecond.
    for (const subject of subjects) await queue.queue('ana@example.com', 'test', { subject, text: 'words' });
    await queue.send(new Date(Date.now() + 1000));
    expect(sent).toEqual(subjects);
  } finally {
    await store.close();
  }
});
