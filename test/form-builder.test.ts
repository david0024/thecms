/**
 * Forms built on their own screen (ADR 0049): the fields a form has, the
 * block that shows one, the server that checks each field as the form says,
 * the messages kept field by field and given as CSV, and a site from before,
 * whose contact form becomes the ready one.
 */
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  answersText,
  type Block,
  checkAnswers,
  contactForm,
  emptyForm,
  type Form,
  formIn,
  messagesCsv,
  nextFieldId,
  normalizeBlocks,
  normalizeForm,
  normalizeForms,
  normalizeSite,
  parseTheme,
  type Theme,
} from '../src/core/index.ts';
import { wordsFor } from '../src/blocks/words.ts';
import { renderPage, renderParts } from '../src/site/document.ts';
import { startForms } from '../src/site/forms.ts';
import '../src/site/languages.ts';
import { type EditorServer, startEditor } from '../src/site/server.ts';
import { Store } from '../src/site/store.ts';
import plain from '../themes/plain.json';

const theme = parseTheme(plain).theme as Theme;
const en = wordsFor('en');
const page = (blocks: Block[]) => ({ slug: 'quote', title: 'Quote', description: '', inMenu: true, blocks });
const main = (html: string): string => html.slice(html.indexOf('<main'), html.indexOf('</main>'));

/** A quote request with a field of every kind. */
const quote = (): Form =>
  normalizeForm(
    {
      name: 'quote',
      title: 'Quote request',
      fields: [
        { id: 'name', kind: 'text', label: 'Name', required: true },
        { id: 'email', kind: 'email', label: 'Email', required: true },
        { id: 'f1', kind: 'phone', label: 'Phone' },
        { id: 'f2', kind: 'number', label: 'Guests', required: true },
        { id: 'f3', kind: 'date', label: 'Day' },
        { id: 'f4', kind: 'select', label: 'Room', options: ['Garden', 'Hall'], required: true },
        { id: 'f5', kind: 'radio', label: 'Menu', options: ['Fish', 'Meat'] },
        { id: 'f6', kind: 'checkboxes', label: 'Extras', options: ['Music', 'Flowers', 'Cake'] },
        { id: 'f7', kind: 'textarea', label: 'Anything else' },
      ],
      consent: 'Keep this to answer me.',
      translations: { ro: { consent: 'Păstrați asta.', button: 'Trimite', labels: { f4: 'Sala' }, options: { f4: ['Grădina', ''] } } },
    },
    en,
  ) as Form;

describe('a form', () => {
  test('is cleaned: a field it cannot have is left out, each name once, every word given', () => {
    const form = normalizeForm(
      {
        name: 'Cerere Ofertă!',
        fields: [
          { id: 'back', kind: 'text', label: 'Reserved name' },
          { id: 'x', kind: 'nonsense', label: 'Unknown kind' },
          { id: 'x', kind: 'email', label: 'Same id' },
          { kind: 'select', label: 'No options', options: [] },
          { kind: 'radio', label: 'Options', options: ['A', 'A', ' ', 'B'], required: 'yes' },
          { kind: 'text', label: '' },
          'not a field',
        ],
        translations: { ro: { labels: { x: 'Numele', gone: 'Nu' }, options: { f1: ['', ''] }, consent: '  ' }, 'not a language!': {} },
      },
      en,
    ) as Form;
    expect(form.name).toBe('cerere-oferta');
    expect(form.title).toBe('cerere-oferta');
    expect(form.fields.map((f) => [f.id, f.kind, f.label, f.required, f.options])).toEqual([
      ['f1', 'text', 'Reserved name', false, []],
      ['x', 'text', 'Unknown kind', false, []],
      ['f2', 'email', 'Same id', false, []],
      ['f3', 'radio', 'Options', false, ['A', 'B']],
    ]);
    expect(form.consent).toBe(en.formConsent);
    expect(form.translations).toEqual({ ro: { labels: { x: 'Numele' } } });
    expect(normalizeForm({ name: '' }, en)).toBeNull();
    expect(normalizeForm('nothing', en)).toBeNull();
    expect(normalizeForms([{ name: 'a' }, { name: 'a' }, null], en).map((f) => f.name)).toEqual(['a']);
    expect(normalizeForms(Array.from({ length: 60 }, (_, i) => ({ name: `f${i}` })), en)).toHaveLength(50);
    expect(normalizeForms('nothing', en)).toEqual([]);
    expect(nextFieldId({ fields: [{ id: 'f1' }, { id: 'f3' }] as Form['fields'] })).toBe('f2');
    expect(emptyForm(en, 'blank', 'Blank').fields).toEqual([]);
  });

  test('in another language shows its words there, and the main language\'s where none is given', () => {
    const ro = formIn(quote(), 'ro');
    expect(ro.consent).toBe('Păstrați asta.');
    expect(ro.button).toBe('Trimite');
    expect(ro.sent).toBe(en.formSent);
    const room = ro.fields.find((f) => f.id === 'f4');
    expect(room?.label).toBe('Sala');
    expect(room?.options).toEqual(['Garden', 'Hall']);
    expect(room?.shown).toEqual(['Grădina', 'Hall']);
    expect(formIn(quote(), 'de').consent).toBe('Keep this to answer me.');
  });

  test('checks what a visitor sent, field by field', () => {
    const good: Record<string, string[]> = { name: ['Ana'], email: ['ana@example.org'], f1: ['+40 721 000 000'], f2: ['12'], f3: ['2026-12-24'], f4: ['Hall'], f5: ['Fish'], f6: ['Music', 'Cake', 'Music'], f7: ['Two lines\nof it'] };
    const sent = (change: Record<string, string[]> = {}) => checkAnswers(quote(), (name) => ({ ...good, ...change })[name] ?? []);
    const ok = sent();
    expect('answers' in ok && ok.answers.find((a) => a.id === 'f6')?.value).toBe('Music, Cake');
    expect('answers' in ok && answersText(ok.answers)).toContain('Anything else:\nTwo lines\nof it');
    const wrong = (change: Record<string, string[]>): string => {
      const result = sent(change);
      return 'wrong' in result ? result.wrong : '';
    };
    expect(wrong({ name: [' '] })).toBe('name');
    expect(wrong({ name: ['two\nlines'] })).toBe('name');
    expect(wrong({ name: ['x'.repeat(201)] })).toBe('name');
    expect(wrong({ email: ['not an address'] })).toBe('email');
    expect(wrong({ f1: ['call me'] })).toBe('f1');
    expect(wrong({ f2: ['twelve'] })).toBe('f2');
    expect(wrong({ f3: ['2026-02-30'] })).toBe('f3');
    expect(wrong({ f3: ['tomorrow'] })).toBe('f3');
    expect(wrong({ f4: ['Roof'] })).toBe('f4');
    expect(wrong({ f4: [] })).toBe('f4');
    expect(wrong({ f5: ['Soup'] })).toBe('f5');
    expect(wrong({ f6: ['Music', 'Fireworks'] })).toBe('f6');
    // What is not required may be left empty.
    const some = sent({ f1: [], f3: [], f5: [], f6: [], f7: [] });
    expect('answers' in some && some.answers.filter((a) => a.value).map((a) => a.id)).toEqual(['name', 'email', 'f2', 'f4']);
  });

  test('its messages are a CSV file: a column for each field, safe to open in a spreadsheet', () => {
    const csv = messagesCsv(
      quote(),
      [
        { receivedAt: '2026-11-21T10:00:00.000Z', page: '/quote/', name: 'Ana', email: 'a@example.org', body: '', consent: 'Yes "really"', answers: [{ id: 'name', label: 'Name', value: '=HYPERLINK("x")' }, { id: 'old', label: 'A field since removed', value: 'kept' }] },
      ],
      { receivedAt: 'Received', page: 'Page', consent: 'Consent' },
    );
    const [head, row] = csv.slice(1).split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(head).toBe('"Received","Page","Name","Email","Phone","Guests","Day","Room","Menu","Extras","Anything else","A field since removed","Consent"');
    expect(row).toBe('"2026-11-21T10:00:00.000Z","/quote/","\'=HYPERLINK(""x"")","","","","","","","","","kept","Yes ""really"""');
    // A message from before forms had fields gives its name, address and words.
    const old = messagesCsv(null, [{ receivedAt: 't', page: '/', name: 'Ion', email: 'i@example.org', body: 'Hello', consent: 'c' }], { receivedAt: 'R', page: 'P', consent: 'C' });
    expect(old.slice(1).split('\r\n')[1]).toBe('"t","/","Ion","i@example.org","Hello","c"');
  });
});

describe('the Form block', () => {
  const block = (form = 'quote'): Block => normalizeBlocks([{ type: 'form', content: { form, title: 'Ask us' } }]).blocks[0] as Block;

  test('draws the form it names: every kind of field, the required ones marked, no script', () => {
    const site = { ...normalizeSite({ name: 'S', url: 'https://example.com' }), formDefs: { quote: quote() } };
    const html = main(renderPage(site, theme, page([block()]), []));
    expect(html).toContain('data-form="quote"');
    expect(html).toContain('type="tel"');
    expect(html).toContain('type="number" step="any" required');
    expect(html).toContain('type="date"');
    expect(html).toMatch(/<select [^>]*name="f4" required/);
    expect(html).toContain('<option value="Hall">Hall</option>');
    expect(html).toMatch(/<legend>Menu<\/legend>/);
    expect(html).toContain('type="radio" name="f5" value="Fish"');
    expect(html).toContain('type="checkbox" name="f6" value="Cake"');
    expect(html).toContain('<textarea id=');
    expect(html).toContain('Keep this to answer me.');
    expect(html).not.toContain('<script');
  });

  test('in another language, its words there; each choice still sent in the main language', () => {
    const site = normalizeSite({ name: 'S', language: 'en', languages: ['ro'] });
    const ro = { ...site, language: 'ro', formDefs: { quote: quote() } };
    const html = main(renderPage(ro, theme, page([block()]), []));
    expect(html).toContain('<option value="Garden">Grădina</option>');
    expect(html).toContain('>Păstrați asta.</label>');
  });

  test('a form that is gone draws nothing on the site, and says so in the editor', () => {
    const site = { ...normalizeSite({ name: 'S' }), formDefs: {} };
    expect(main(renderPage(site, theme, page([block('gone')]), []))).not.toContain('<form');
    expect(renderParts(site, theme, page([block('gone')]), [], true).body).toContain('data-form-missing');
    // A block from before forms had names shows the contact form.
    expect(normalizeBlocks([{ type: 'form', content: { form: '' } }]).blocks[0]?.content.form).toBe('contact');
  });
});

describe('forms on the server', () => {
  let dir: string;
  let store: Store;
  const SITE = 'https://example.com';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uhlaka-form-builder-'));
    store = await Store.open(join(dir, 'site.db'));
    await store.setSite({ name: 'Atelier', url: SITE, languages: ['ro'] });
  });
  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('a site starts with the ready contact form, in its language', async () => {
    expect((await store.forms()).map((f) => [f.name, f.title, f.fields.map((x) => x.id)])).toEqual([['contact', 'Contact', ['name', 'email', 'message']]]);
    await store.setSite({ ...(await store.site()), language: 'ro', languages: [] });
    expect((await store.forms())[0]?.consent).toBe(wordsFor('ro').formConsent);
  });

  test('a message is checked as its form says, kept field by field, with the consent in the page\'s language', async () => {
    const mails: { subject: string; text: string; replyTo?: string }[] = [];
    await store.setForms([...(await store.forms()), quote()]);
    const shown = normalizeBlocks([{ type: 'form', content: { form: 'quote' } }]).blocks[0] as Block;
    const saved = await store.savePage({ slug: 'quote', title: 'Quote', blocks: [shown] });
    await store.publish(saved.slug);
    await store.translate('quote', 'ro');
    await store.saveTranslation('quote', 'ro', { ...(await store.locate('ro/quote'))!, slug: 'ro/oferta', title: 'Ofertă' });
    await store.publish('ro/oferta');
    const service = startForms(store, { listen: false, mailer: async (mail) => void mails.push(mail), to: 'owner@example.com', log: () => {} });
    const send = (fields: [string, string][], back = '/quote/') =>
      service.fetch(new Request('http://x/send', { method: 'POST', headers: { origin: SITE, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams([['back', back], ['form', shown.id], ['consent', 'yes'], ...fields]).toString() }), '5.5.5.5');
    const good: [string, string][] = [['name', 'Ana'], ['email', 'ana@example.org'], ['f2', '12'], ['f4', 'Hall'], ['f6', 'Music'], ['f6', 'Cake']];

    expect((await send([...good.filter(([n]) => n !== 'f4'), ['f4', 'Roof']])).headers.get('location')).toEndWith('-failed');
    expect((await send(good, '/ro/oferta/')).headers.get('location')).toBe(`${SITE}/ro/oferta/#f-${shown.id}-sent`);
    const [kept] = await store.messages();
    expect(kept).toMatchObject({ form: 'quote', name: 'Ana', email: 'ana@example.org', consent: 'Păstrați asta.' });
    expect(kept?.answers?.find((a) => a.id === 'f6')).toEqual({ id: 'f6', label: 'Extras', value: 'Music, Cake' });
    await Bun.sleep(1);
    expect(mails[0]).toMatchObject({ subject: 'Atelier: Quote request, from Ana', replyTo: 'ana@example.org' });
    expect(mails[0]?.text).toContain('Room: Hall');

    // A form that asks for no name and no address: the owner is still told, with no one to answer.
    await store.setForms((await store.forms()).map((f) => (f.name === 'quote' ? { ...f, fields: f.fields.filter((x) => x.id !== 'name' && x.id !== 'email') } : f)));
    expect((await send([['f2', '3'], ['f4', 'Garden']])).headers.get('location')).toEndWith('-sent');
    await Bun.sleep(1);
    expect(mails[1]?.replyTo).toBeUndefined();
    expect(mails[1]?.text).toStartWith('A visitor wrote');

    // A message's answers go with it.
    for (const m of await store.messages()) await store.deleteMessage(m.id);
    const db = new Database(join(dir, 'site.db'));
    expect(db.query('SELECT COUNT(*) AS n FROM message_answers').get()).toEqual({ n: 0 });
    db.close();
  });

  test('a form a page shows is not deleted; the admin builds, changes and deletes the others', async () => {
    await store.setTheme(plain);
    const editor: EditorServer = await startEditor(store, { listen: false });
    const call = async (method: string, body?: unknown) =>
      editor.fetch(new Request('http://127.0.0.1:4321/api/forms', { method, headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));
    try {
      await store.savePage({ slug: 'contact', title: 'Contact', blocks: normalizeBlocks([{ type: 'form', content: { form: 'contact' } }]).blocks });
      await store.addMessage({ form: 'contact', page: '/contact/', name: 'A', email: 'a@example.org', body: 'x', consent: 'c' });
      const first = (await (await call('GET')).json()) as { forms: Form[]; usedOn: Record<string, string[]>; counts: Record<string, number> };
      expect(first.usedOn).toEqual({ contact: ['/contact/'] });
      expect(first.counts).toEqual({ contact: 1 });
      const added = (await (await call('PUT', { forms: [...first.forms, quote()] })).json()) as { forms: Form[] };
      expect(added.forms.map((f) => f.name)).toEqual(['contact', 'quote']);
      const refused = await call('PUT', { forms: [quote()] });
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: string }).error).toContain('/contact/');
      expect(((await (await call('PUT', { forms: added.forms.slice(0, 1) })).json()) as { forms: Form[] }).forms.map((f) => f.name)).toEqual(['contact']);
      // A block chooses among them; the page is drawn with the form it names.
      const state = (await (await editor.fetch(new Request('http://127.0.0.1:4321/api/state', { headers: { host: '127.0.0.1:4321', 'x-uhlaka-token': editor.token } }))).json()) as { forms: { name: string; title: string }[] };
      expect(state.forms).toEqual([{ name: 'contact', title: 'Contact' }]);
    } finally {
      editor.stop();
    }
  });
});

describe('a site from before forms were built', () => {
  test('its contact form becomes the ready one, with the words its owner wrote, and its messages Contact\'s', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'uhlaka-form-old-'));
    const file = join(dir, 'site.db');
    try {
      const store = await Store.open(file);
      await store.setSite({ name: 'Old' });
      await store.savePage({ slug: 'contact', title: 'Contact', blocks: [] });
      await store.addMessage({ form: 'b_old', page: '/contact/', name: 'A', email: 'a@example.org', body: 'x', consent: 'c' });
      await store.close();
      // As ADR 0019 kept it: the words in the block, no forms.
      const db = new Database(file);
      const old = { slug: 'contact', title: 'Contact', blocks: [{ id: 'b_old', type: 'group', content: {}, children: [{ id: 'b_form', type: 'form', content: { title: 'Write', consent: 'Keep what I write.', button: 'Go', sent: '', failed: 'No.' } }] }] };
      db.run('UPDATE pages SET draft = ? WHERE slug = ?', [JSON.stringify(old), 'contact']);
      db.run("DELETE FROM meta WHERE key = 'forms'");
      db.close();

      const again = await Store.open(file);
      const [contact] = await again.forms();
      expect(contact).toMatchObject({ name: 'contact', consent: 'Keep what I write.', button: 'Go', sent: en.formSent, failed: 'No.' });
      expect((await again.messages()).map((m) => m.form)).toEqual(['contact']);
      await again.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
