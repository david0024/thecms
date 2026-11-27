/** A small extension for the tests: each action shows one thing the host allows or refuses. */
type Host = import('../../../src/site/extension-runner.ts').ExtensionHost;
type Block = { id: string; type: string; content: Record<string, unknown> };

const loud = async (host: Host): Promise<(text: string) => string> => {
  const [setting] = await host.collections.list('settings');
  return setting?.style === 'stars' ? (t) => `*${t}*` : (t) => t.toUpperCase();
};

export const actions = {
  async louder(input: { block: Block; language: string }, host: Host) {
    const say = await loud(host);
    await host.collections.insert('log', { what: `louder ${input.block.type} in ${input.language}` });
    const content = Object.fromEntries(Object.entries(input.block.content).map(([k, v]) => [k, typeof v === 'string' ? say(v) : v]));
    return { block: { ...input.block, content, type: input.block.type } };
  },
  async title(input: { page: { title: string }; ask: { language: string } }, host: Host) {
    const say = await loud(host);
    return { page: { ...input.page, title: `${say(input.page.title)} (${input.ask.language})` } };
  },
  /** A description, said of the page's title: what the table of titles and descriptions asks for each page (ADR 0064 d2). */
  async describe(input: { page: { title: string } }) {
    return { page: { ...input.page, description: `All about ${input.page.title}.` } };
  },
  /** Marks every text of a page with its language, prices and addresses too: what is kept of it is the editor's to say. */
  async stamp(input: { page: { title: string; description: string; blocks: Block[] }; language: string }) {
    if (input.page.title === 'Nothing') return {};
    const mark = (value: unknown): unknown => (typeof value === 'string' ? (value ? `[${input.language}] ${value}` : value) : Array.isArray(value) ? value.map(mark) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'id' || k === 'type' || k === 'src' ? v : mark(v)])) : value);
    return { page: { ...input.page, title: mark(input.page.title), description: mark(input.page.description), blocks: input.page.blocks.map((b) => ({ ...b, content: mark(b.content) })) } };
  },
  async ping(_input: unknown, host: Host) {
    const site = await host.site();
    const answer = await host.fetch('https://api.shout.example/ping', { method: 'POST', body: site.name });
    const [setting] = await host.collections.list('settings');
    return { status: answer.status, body: answer.body, key: setting?.key ?? null };
  },
  async sneak(input: { how: string }, host: Host) {
    if (input.how === 'fetch') return fetch('https://api.shout.example/');
    if (input.how === 'elsewhere') return host.fetch('https://evil.example/');
    if (input.how === 'http') return host.fetch('http://api.shout.example/');
    if (input.how === 'write') return host.collections.insert('settings', { name: 'mine' });
    if (input.how === 'undeclared') return host.collections.list('users');
    if (input.how === 'picture') return host.picture('/media/x.png');
    return { env: Object.keys(process.env).filter((k) => k !== 'PATH') };
  },
  async look(input: { src: string }, host: Host) {
    const picture = await host.picture(input.src);
    return picture && { type: picture.type, bytes: atob(picture.data).length };
  },
  async slow() {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return {};
  },
  async crash() {
    process.exit(3);
  },
  async rotate(input: { id?: string; note?: string }, host: Host) {
    await host.collections.insert('log', { what: `new key for ${input.id ?? 'none'}: ${input.note ?? ''}` });
    return { reveal: `sk-${input.id ?? 'none'}-${(input.note ?? '').length}` };
  },
  async open() {
    return { view: 'shout.log' };
  },
};
