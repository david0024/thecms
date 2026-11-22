<script lang="ts">
/**
 * A block an installed extension adds (ADR 0062 d6): a form, drawn as the
 * site draws its own, with the theme and no script, and posted to the
 * extension's route. The extension answers with a page drawn in the site's
 * layout, or the visitor is sent back here, to `#…-sent` or `#…-failed`,
 * and the stylesheet shows the matching words (ADR 0019).
 *
 * The extension's words are said in the page's language when it gives them.
 */
import type { Block } from '../core/index.ts';
import { getSite, isEditing, marker } from './editing.ts';
import { wordsFor } from './words.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as { block?: string; title?: string; intro?: string });
const editing = isEditing();
const mark = marker();
const where = getSite();
const language = where?.site.language ?? 'en';
const words = wordsFor(language);
const def = $derived(where?.site.extensionBlocks?.[c.block ?? '']);
/** The extension's word in the page's language, or its own. */
const say = (word: string): string => def?.messages[language]?.[word] || def?.messages[language.split('-')[0] as string]?.[word] || word;
// A page in another language asks to be answered in it, as search does (ADR 0054).
const other = $derived(!!where?.site.languages.includes(language));
const action = $derived(def ? `/_/x/${def.extension}/${def.block.route}${other ? `?l=${encodeURIComponent(language)}` : ''}` : '');
const id = (name: string): string => `f-${block.id}-${name}`;
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
{#if c.intro || editing}<p class="lead" data-edit={mark('intro')} data-multiline={mark('1')}>{c.intro}</p>{/if}
{#if def}
  <p class="form-note form-sent" id={id('sent')} role="status">{def.block.sent ? say(def.block.sent) : words.blockSent}</p>
  <p class="form-note form-failed" id={id('failed')} role="alert">{words.blockFailed}</p>
  <form class="form" method="post" action={editing ? undefined : action} accept-charset="utf-8" data-extension-block={c.block}>
    <input type="hidden" name="back" value={where?.path ?? '/'} />
    <input type="hidden" name="block" value={def.block.name} />
    <input type="hidden" name="form" value={block.id} />
    <!-- Left empty by people; a robot that fills every field gives itself away. -->
    <p class="form-trap" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off" /></label></p>
    {#each def.block.fields as field (field.key)}
      {#if field.kind === 'consent'}
        <p class="form-consent"><input id={id(field.key)} name={field.key} type="checkbox" value="yes" required disabled={editing} /><label for={id(field.key)}>{say(field.label)}</label></p>
      {:else}
        <p class="form-field">
          <label for={id(field.key)}>{say(field.label)}{#if field.required}<span class="form-required" aria-hidden="true">*</span>{/if}</label>
          {#if field.kind === 'textarea'}
            <textarea id={id(field.key)} name={field.key} rows="6" maxlength="5000" required={field.required} disabled={editing}></textarea>
          {:else if field.kind === 'select'}
            <select id={id(field.key)} name={field.key} required={field.required} disabled={editing}>
              <option value="">{words.formChoose}</option>
              {#each field.options as option (option)}<option value={option}>{say(option)}</option>{/each}
            </select>
          {:else if field.kind === 'email'}
            <input id={id(field.key)} name={field.key} type="email" maxlength="254" autocomplete="email" required={field.required} disabled={editing} />
          {:else if field.kind === 'phone'}
            <input id={id(field.key)} name={field.key} type="tel" maxlength="40" autocomplete="tel" required={field.required} disabled={editing} />
          {:else if field.kind === 'number'}
            <input id={id(field.key)} name={field.key} type="number" step="any" required={field.required} disabled={editing} />
          {:else if field.kind === 'date'}
            <input id={id(field.key)} name={field.key} type="date" required={field.required} disabled={editing} />
          {:else}
            <input id={id(field.key)} name={field.key} type="text" maxlength="200" required={field.required} disabled={editing} />
          {/if}
        </p>
      {/if}
    {/each}
    <p><button class="button" type={editing ? 'button' : 'submit'}>{say(def.block.submit)}</button></p>
  </form>
{:else if editing}
  <p class="form-note shown" data-extension-missing>{words.blockMissing}</p>
{/if}
