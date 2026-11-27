<script lang="ts">
/**
 * Code, drawn as written (ADR 0067): every line and space kept, in a
 * fixed-width font. On a phone a long line scrolls inside the block, never the
 * page. The language is said as `language-<name>`, the class other tools read.
 */
import { type Block, type CodeContent, codeLanguage } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as CodeContent);
const editing = isEditing();
const mark = marker();
const language = $derived(codeLanguage(c.language));
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
<figure class="figure code-figure">
  <pre class="code"><code class={language ? `language-${language}` : undefined} data-edit={mark('code')} data-multiline={mark('1')}>{c.code}</code></pre>
  {#if c.caption || editing}<figcaption data-edit={mark('caption')}>{c.caption}</figcaption>{/if}
</figure>
