/**
 * Compiles `.svelte` files for the server when Bun imports them.
 *
 * The public site is static HTML, so components are only ever rendered on the
 * server here; the editor, which runs in a browser, has its own build.
 */
import { plugin } from 'bun';
import { compile } from 'svelte/compiler';

plugin({
  name: 'svelte-server',
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const { js } = compile(source, { filename: path, generate: 'server', dev: false });
      return { contents: js.code, loader: 'js' };
    });
  },
});
