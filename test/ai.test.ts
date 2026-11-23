/**
 * The AI extension (ADR 0027): what it sends a model, what it does with the
 * answer, and that the package installs and runs like any other extension.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actions } from '../extensions/ai/index.ts';
import { chosen, complete, hostFetch } from '../extensions/ai/providers.ts';
import { blockWords, languageName, pageWords, withBlockWords, withPageWords } from '../extensions/ai/words.ts';
import { parseExtension } from '../src/core/index.ts';
import type { ExtensionHost } from '../src/site/extension-runner.ts';
import { extensionHost } from '../src/site/extensions.ts';
import { Store } from '../src/site/store.ts';
import { packExtension } from '../tools/pack-extension.ts';

const hero = {
  id: 'b1',
  type: 'hero',
  content: { eyebrow: '', title: 'Oak tables', subtitle: 'Made to measure.', image: { src: '/media/t.jpg', alt: 'A table' }, action: { label: 'Ask', href: 'https://x.example/ask' } },
};
const text = {
  id: 'b2',
  type: 'text',
  content: { body: [{ type: 'heading', level: 2, children: [{ text: 'Wood', marks: ['bold'] }] }, { type: 'list', ordered: false, items: [[{ text: 'Oak' }], [{ text: 'Ash', href: '/ash' }]] }] },
};
const faq = { id: 'b3', type: 'faq', content: { items: [{ question: 'How long?', answer: 'Six weeks.' }], title: '/not-words' } };
const page = { slug: 'ro/about', title: 'About', description: '', inMenu: true, blocks: [hero, text] };

describe('the words', () => {
  test('of a block are what a reader reads, with where each is', () => {
    expect(blockWords(hero)).toEqual([
      { place: 'title', text: 'Oak tables' },
      { place: 'subtitle', text: 'Made to measure.' },
      { place: 'image.alt', text: 'A table' },
      { place: 'action.label', text: 'Ask' },
    ]);
    expect(blockWords(hero, true)[0]).toEqual({ place: 'eyebrow', text: '' });
    expect(blockWords(text)).toEqual([
      { place: 'body.0.0', text: 'Wood' },
      { place: 'body.1.0.0', text: 'Oak' },
      { place: 'body.1.1.0', text: 'Ash' },
    ]);
    expect(blockWords(faq)).toEqual([
      { place: 'items.0.question', text: 'How long?' },
      { place: 'items.0.answer', text: 'Six weeks.' },
    ]);
  });

  test('go back where they came from, and nothing else changes', () => {
    const next = withBlockWords(hero, ['Lead', 'T', 'S', 'Alt', 'Go'], true);
    expect(next.content).toEqual({ eyebrow: 'Lead', title: 'T', subtitle: 'S', image: { src: '/media/t.jpg', alt: 'Alt' }, action: { label: 'Go', href: 'https://x.example/ask' } });
    const rich = withBlockWords(text, ['Lemn', 'Stejar', 'Frasin']);
    expect(rich.content.body).toEqual([{ type: 'heading', level: 2, children: [{ text: 'Lemn', marks: ['bold'] }] }, { type: 'list', ordered: false, items: [[{ text: 'Stejar' }], [{ text: 'Frasin', href: '/ash' }]] }]);
    expect(withBlockWords(hero, []).content.title).toBe('Oak tables');
  });

  test('of a page are its title, its description when it has one, and its blocks', () => {
    const places = pageWords(page);
    expect(places[0]).toEqual({ place: 'title', text: 'About' });
    expect(places[1]).toEqual({ place: 'block 1 (hero) title', text: 'Oak tables' });
    expect(places).toHaveLength(8);
    const back = withPageWords(page, places.map((p) => p.text.toUpperCase()));
    expect(back.title).toBe('ABOUT');
    expect(back.description).toBe('');
    expect(back.blocks[1]?.content.body).toEqual(withBlockWords(text, ['WOOD', 'OAK', 'ASH']).content.body);
    const described = { ...page, description: 'Who we are' };
    expect(pageWords(described)[1]).toEqual({ place: 'description', text: 'Who we are' });
    expect(withPageWords(described, ['A', 'B']).description).toBe('B');
    expect(withPageWords(described, []).title).toBe('About');
  });

  test('a language is named for the model', () => {
    expect(languageName('ro')).toBe('Romanian');
    expect(languageName('pt-BR')).toBe('Brazilian Portuguese');
    expect(languageName('not a tag')).toBe('not a tag');
  });
});

describe('the provider', () => {
  test('is the one the owner marked, or the first', () => {
    expect(() => chosen([])).toThrow('Add a provider first');
    expect(chosen([{ name: 'A', kind: 'anthropic', api_key: 'k' }])).toEqual({ name: 'A', kind: 'anthropic', model: 'claude-opus-5-5', api_key: 'k', base_url: '' });
    expect(chosen([{ name: 'A', api_key: 'k' }, { name: 'B', kind: 'openai', model: 'm', api_key: 'k2', default: true }]).name).toBe('B');
    expect(chosen([{ name: 'L', kind: 'ollama', model: 'llama', base_url: 'http://127.0.0.1:11434/' }]).base_url).toBe('http://127.0.0.1:11434');
    expect(() => chosen([{ name: 'O', kind: 'openai', api_key: 'k' }])).toThrow('Write the name of the model "O" uses.');
    expect(() => chosen([{ name: 'A', kind: 'anthropic' }])).toThrow('"A" has no API key.');
    expect(chosen([{ kind: 'ollama', model: 'llama' }]).name).toBe('ollama');
  });
});

/** A host that answers each call with what the test gives, and keeps what was sent. */
function fakeHost(rows: Record<string, unknown>[], answer: (url: string, body: Record<string, unknown>) => { status?: number; body: unknown }) {
  const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const usage: Record<string, unknown>[] = [];
  const host: ExtensionHost = {
    collections: {
      list: async (c) => (c === 'providers' ? rows : []),
      read: async () => null,
      insert: async (_c, row) => (usage.push(row), row),
      update: async (_c, _id, row) => row,
      delete: async () => {},
      add: async (_c, id, numbers) => ({ ...numbers, id }),
    },
    members: { get: async () => null, find: async () => null, levels: async () => [], give: async () => [], take: async () => [] },
    mail: { send: async () => {} },
    fetch: async (url, init) => {
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      sent.push({ url, headers: init?.headers ?? {}, body });
      const a = answer(url, body);
      return { status: a.status ?? 200, headers: { 'content-type': 'application/json' }, body: typeof a.body === 'string' ? a.body : JSON.stringify(a.body) };
    },
    site: async () => ({ name: 'Oak & Co', language: 'en', languages: ['ro'] }),
    picture: async (src) => (src.startsWith('/media/') ? { type: 'image/webp', data: btoa(`bytes of ${src}`) } : null),
    published: async () => [],
  };
  return { host, sent, usage };
}

const claude = (texts: unknown, over: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: typeof texts === 'string' ? texts : JSON.stringify({ texts }) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 120, output_tokens: 30 },
  ...over,
});
const site = { name: 'Oak & Co', language: 'en', languages: ['ro'] };
const ANTHROPIC = [{ name: 'Claude', kind: 'anthropic', api_key: 'sk-ant' }];

describe('with Claude', () => {
  test('a page is translated into its language, through the program, with a fallback model', async () => {
    const { host, sent, usage } = fakeHost(ANTHROPIC, (_u, body) => {
      const prompt = String((body.messages as { content: string }[])[0]?.content);
      const places = JSON.parse(prompt.slice(prompt.indexOf('['))) as { text: string }[];
      return { body: claude(places.map((p) => `ro:${p.text}`)) };
    });
    const { page: out } = await actions.translate({ page, language: 'ro', site }, host);
    expect(out.title).toBe('ro:About');
    expect(out.blocks[0]?.content.image).toEqual({ src: '/media/t.jpg', alt: 'ro:A table' });
    expect(out.blocks[0]?.content.action).toEqual({ label: 'ro:Ask', href: 'https://x.example/ask' });
    const [call] = sent;
    expect(call?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call?.headers.authorization).toBe('Bearer sk-ant');
    expect(call?.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(call?.body.fallbacks).toBe('default');
    expect(call?.body.model).toBe('claude-opus-5-5');
    expect(call?.body.output_config).toMatchObject({ effort: 'medium', format: { type: 'json_schema' } });
    expect(String(call?.body.system)).toContain('into Romanian');
    expect(usage).toEqual([{ action: 'translate', provider: 'Claude', model: 'claude-opus-5-5', input_tokens: 120, output_tokens: 30 }]);
  });

  test('a block is written as the owner asks, its empty places too', async () => {
    const { host, sent } = fakeHost(ANTHROPIC, () => ({ body: claude(['Since 1998', 'Oak tables', 'Shorter.', 'An oak table', 'Ask us']) }));
    const { block } = await actions.write({ block: hero, language: 'en', ask: { instruction: 'shorter' }, site }, host);
    expect(block.content.eyebrow).toBe('Since 1998');
    expect(block.id).toBe('b1');
    expect(String((sent[0]?.body.messages as { content: string }[])[0]?.content)).toContain('What the owner asks:\nshorter');
    const again = await actions.write({ block: hero, language: 'en', ask: {}, site }, host);
    expect(again.block.content.subtitle).toBe('Shorter.');
    expect(String((sent[1]?.body.messages as { content: string }[])[0]?.content)).toContain('Make these words clearer');
    await expect(actions.write({ block: { id: 'x', type: 'part', content: { part: 'title' } }, language: 'en', ask: {}, site }, host)).rejects.toThrow('no words');
  });

  test('a description is written from the page, and kept short', async () => {
    const { host } = fakeHost(ANTHROPIC, () => ({ body: claude(['x'.repeat(400)]) }));
    const { page: out } = await actions.describe({ page: { ...page, description: 'old' }, language: 'en', site }, host);
    expect(out.description).toHaveLength(300);
    expect(out.title).toBe('About');
  });

  test('says plainly when the model declines, runs out of room, or answers in another form', async () => {
    for (const [answer, said] of [
      [claude([], { stop_reason: 'refusal' }), 'would not write this'],
      [claude([], { stop_reason: 'max_tokens' }), 'too long'],
      [claude('not json'), 'did not answer in the form'],
      [claude('{"texts": [1]}'), 'did not answer in the form'],
      [claude(['one']), 'wrote 1 texts for 2 places'],
    ] as const) {
      const { host } = fakeHost(ANTHROPIC, () => ({ body: answer }));
      await expect(complete(chosen(ANTHROPIC), { system: 's', prompt: 'p', effort: 'low' }, 2, host)).rejects.toThrow(said);
    }
  });

  test('the SDK is given a fetch that is the program’s', async () => {
    const calls: unknown[] = [];
    const { host } = fakeHost([], (url, body) => (calls.push([url, body]), { status: 201, body: { ok: true } }));
    const f = hostFetch(host);
    const response = await f(new Request('https://api.anthropic.com/x'), { method: 'POST', headers: { a: 'b' }, body: '{"q":1}' });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    await f('https://api.anthropic.com/y');
    expect(calls).toEqual([['https://api.anthropic.com/x', { q: 1 }], ['https://api.anthropic.com/y', {}]]);
  });
});

describe('with OpenAI and Ollama', () => {
  const ask = { system: 's', prompt: 'p', effort: 'low' as const };
  test('OpenAI is asked for the same shape, with the key', async () => {
    const { host, sent } = fakeHost([], () => ({ body: { model: 'gpt-x', choices: [{ message: { content: '{"texts":["a"]}' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } } }));
    const answer = await complete(chosen([{ name: 'O', kind: 'openai', model: 'gpt-x', api_key: 'sk' }]), ask, 1, host);
    expect(answer).toEqual({ texts: ['a'], model: 'gpt-x', input: 5, output: 2 });
    expect(sent[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(sent[0]?.headers.authorization).toBe('Bearer sk');
    expect(sent[0]?.body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
  });

  test('OpenAI’s refusals and errors are said', async () => {
    const provider = chosen([{ name: 'O', kind: 'openai', model: 'gpt-x', api_key: 'sk' }]);
    for (const [answer, said] of [
      [{ body: { choices: [{ message: { refusal: 'no' } }] } }, 'would not write this'],
      [{ status: 401, body: { error: { message: 'bad key' } } }, 'OpenAI answered 401: bad key'],
      [{ status: 500, body: 'down' }, 'OpenAI answered 500: down'],
      [{ status: 429, body: { error: {} } }, /OpenAI answered 429$/],
      [{ body: {} }, 'did not answer in the form'],
    ] as const) {
      const { host } = fakeHost([], () => answer);
      await expect(complete(provider, ask, 1, host)).rejects.toThrow(said);
    }
    const { host } = fakeHost([], () => ({ body: { choices: [{ message: { content: '{"texts":["a"]}' } }] } }));
    expect(await complete(provider, ask, 1, host)).toEqual({ texts: ['a'], model: 'gpt-x', input: 0, output: 0 });
  });

  test('Ollama runs on the owner’s own machine, at the address given', async () => {
    const { host, sent } = fakeHost([], () => ({ body: { model: 'llama', message: { content: '{"texts":["a"]}' }, prompt_eval_count: 9, eval_count: 3 } }));
    expect(await complete(chosen([{ name: 'L', kind: 'ollama', model: 'llama' }]), ask, 1, host)).toEqual({ texts: ['a'], model: 'llama', input: 9, output: 3 });
    expect(sent[0]?.url).toBe('http://localhost:11434/api/chat');
    expect(sent[0]?.headers.authorization).toBeUndefined();
    expect(sent[0]?.body).toMatchObject({ model: 'llama', stream: false, format: { type: 'object' } });
    await complete(chosen([{ name: 'L', kind: 'ollama', model: 'llama', base_url: 'http://127.0.0.1:9000', api_key: 'k' }]), ask, 1, host);
    expect(sent[1]?.url).toBe('http://127.0.0.1:9000/api/chat');
    expect(sent[1]?.headers.authorization).toBe('Bearer k');
    const failing = fakeHost([], () => ({ status: 404, body: { error: 'model "llama" not found' } }));
    await expect(complete(chosen([{ name: 'L', kind: 'ollama', model: 'llama' }]), ask, 1, failing.host)).rejects.toThrow('Ollama answered 404: model "llama" not found');
    const bare = fakeHost([], () => ({ body: { message: { content: '{"texts":["a"]}' } } }));
    expect(await complete(chosen([{ name: 'L', kind: 'ollama', model: 'llama' }]), ask, 1, bare.host)).toEqual({ texts: ['a'], model: 'llama', input: 0, output: 0 });
  });
});

describe('search engines and pictures (ADR 0059)', () => {
  test('a title for search engines is written from the page, and only that changes', async () => {
    const { host, sent, usage } = fakeHost(ANTHROPIC, () => ({ body: claude(['  Oak tables made to measure   in Cluj  ']) }));
    const { page: out } = await actions.title({ page, language: 'ro', site }, host);
    expect(out.seoTitle).toBe('Oak tables made to measure in Cluj');
    expect(out.title).toBe('About');
    expect(out.blocks).toEqual(page.blocks);
    expect(String(sent[0]?.body.system)).toContain('at most 60 characters');
    expect(String(sent[0]?.body.system)).toContain('Write in Romanian');
    expect(usage[0]?.action).toBe('title');
  });

  const gallery = {
    id: 'g1',
    type: 'gallery',
    content: {
      title: 'Our workshop',
      items: [
        { image: { src: '/media/a.webp', alt: '' }, caption: 'The bench' },
        { image: { src: '/media/b.webp', alt: 'Planks drying' }, caption: '' },
        { image: { src: 'https://elsewhere.example/c.jpg', alt: '' }, caption: '' },
      ],
    },
  };

  test('the pictures without words are described from the pictures themselves', async () => {
    const { host, sent, usage } = fakeHost(ANTHROPIC, () => ({ body: claude(['A carpenter planing an oak board on a wooden bench']) }));
    const { block } = await actions.pictures({ block: gallery, language: 'en', site }, host);
    const items = block.content.items as { image: { src: string; alt: string } }[];
    expect(items.map((i) => i.image.alt)).toEqual(['A carpenter planing an oak board on a wooden bench', 'Planks drying', '']);
    expect(gallery.content.items[0]?.image.alt).toBe('');
    const content = (sent[0]?.body.messages as { content: { type: string; source?: unknown; text?: string }[] }[])[0]?.content ?? [];
    expect(content.map((c) => c.type)).toEqual(['image', 'text']);
    expect(content[0]?.source).toEqual({ type: 'base64', media_type: 'image/webp', data: btoa('bytes of /media/a.webp') });
    expect(content[1]?.text).toContain('The bench');
    expect(content[1]?.text).not.toContain('Planks drying');
    expect(usage[0]?.action).toBe('pictures');
  });

  test('when every picture has words, each is described again', async () => {
    const { host } = fakeHost(ANTHROPIC, () => ({ body: claude(['One', 'Two']) }));
    const all = { ...gallery, content: { ...gallery.content, items: gallery.content.items.slice(0, 2).map((i) => ({ ...i, image: { ...i.image, alt: 'old' } })) } };
    const { block } = await actions.pictures({ block: all, language: 'en', site }, host);
    expect((block.content.items as { image: { alt: string } }[]).map((i) => i.image.alt)).toEqual(['One', 'Two']);
  });

  test('says so when there is no picture to show the model', async () => {
    const { host } = fakeHost(ANTHROPIC, () => ({ body: claude(['x']) }));
    await expect(actions.pictures({ block: { id: 't', type: 'text', content: { body: [] } }, language: 'en', site }, host)).rejects.toThrow('no pictures');
    const avif = { ...host, picture: async () => ({ type: 'image/avif', data: 'x' }) };
    await expect(actions.pictures({ block: gallery, language: 'en', site }, avif)).rejects.toThrow('cannot be shown to the model');
  });

  test('OpenAI and Ollama are shown the pictures in their own way', async () => {
    const picture = { type: 'image/png', data: 'AAAA' };
    const ask = { system: 's', prompt: 'p', effort: 'low' as const, images: [picture] };
    const openai = fakeHost([], () => ({ body: { choices: [{ message: { content: '{"texts":["a"]}' } }] } }));
    await complete(chosen([{ name: 'O', kind: 'openai', model: 'gpt-x', api_key: 'sk' }]), ask, 1, openai.host);
    expect((openai.sent[0]?.body.messages as { content: unknown }[])[1]?.content).toEqual([{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }, { type: 'text', text: 'p' }]);
    const ollama = fakeHost([], () => ({ body: { message: { content: '{"texts":["a"]}' } } }));
    await complete(chosen([{ name: 'L', kind: 'ollama', model: 'llava' }]), ask, 1, ollama.host);
    expect((ollama.sent[0]?.body.messages as { images?: string[] }[])[1]?.images).toEqual(['AAAA']);
  });
});

const dir = await mkdtemp(join(tmpdir(), 'thecms-ai-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('the package', () => {
  test('installs and translates a page in its own process, calling only Anthropic', async () => {
    const { file } = await packExtension(join(import.meta.dir, '..', 'extensions', 'ai'), dir);
    const text = await Bun.file(file).text();
    const { pkg, problems } = parseExtension(JSON.parse(text));
    expect(problems).toEqual([]);
    expect(pkg?.manifest.actions.map((a) => `${a.name}:${a.on}:${a.each}`)).toEqual(['write:block:null', 'translate:page:language', 'describe:page:null', 'title:page:null', 'pictures:block:null']);
    expect(pkg?.manifest.actions.filter((a) => a.pictures).map((a) => a.name)).toEqual(['pictures']);
    const store = await Store.open(join(dir, 'site.db'));
    const called: string[] = [];
    const host = extensionHost(store, {
      fetch: async (url, init) => {
        called.push(url);
        const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
        const prompt = body.messages[0]?.content ?? '';
        const places = JSON.parse(prompt.slice(prompt.indexOf('['))) as { text: string }[];
        return Response.json(claude(places.map((p) => `ro:${p.text}`)));
      },
    });
    try {
      const offer = await host.offer(text);
      expect(offer.asks.secrets).toEqual(['Providers: API key']);
      await host.install(text, offer.sha256);
      await host.enable('ai', true);
      await store.saveExtensionRow('ai', 'providers', { name: 'Claude', kind: 'anthropic', model: '', api_key: 'sk-ant', base_url: '', default: true });
      const answer = (await host.run('ai', 'translate', { page, language: 'ro', site })) as { page: { title: string } };
      expect(answer.page.title).toBe('ro:About');
      expect(called).toEqual(['https://api.anthropic.com/v1/messages']);
      expect((await store.extensionRows('ai', 'usage')).map((r) => r.action)).toEqual(['translate']);
    } finally {
      host.close();
      store.close();
    }
  }, 30_000);
});
