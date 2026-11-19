/**
 * Compiles `.svelte` files for the server when Bun imports them.
 *
 * The public site is static HTML, so components are only ever rendered on the
 * server here; the editor, which runs in a browser, has its own build.
 */
import { type BunPlugin, plugin } from 'bun';
import { compile } from 'svelte/compiler';

/** A component as the server runs it. tools/coverage.ts compiles it the same way, to read `bun test`'s lines back to the component's. */
export const compileForServer = (source: string, path: string) => compile(source, { filename: path, generate: 'server', dev: false }).js;

/** The same, for a build: the single executable carries its components compiled (tools/build.ts). */
export const svelteServer: BunPlugin = {
  name: 'svelte-server',
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const js = compileForServer(source, path);
      return { contents: js.code, loader: 'js' };
    });
  },
};

plugin(svelteServer);
