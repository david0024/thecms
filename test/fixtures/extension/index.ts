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
    return { env: Object.keys(process.env).filter((k) => k !== 'PATH') };
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
