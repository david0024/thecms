<script lang="ts">
/**
 * A form a visitor writes to the owner with (ADR 0049): the block names a
 * form built on the Forms screen, and the form's fields are drawn here, in
 * the page's language. It is plain HTML: it posts to the site's server or
 * its form service, which sends the visitor back to this page at `#…-sent`
 * or `#…-failed`, and the stylesheet shows the matching words (ADR 0019).
 * No script, on the site or in the form.
 *
 * A choice is sent as its words in the main language, so every language's
 * messages read alike; the visitor reads its words in theirs.
 */
import { type Block, formIn, formOf, formsAddress } from '../core/index.ts';
import { getSite, isEditing, marker } from './editing.ts';
import { wordsFor } from './words.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as { title?: string; intro?: string });
const editing = isEditing();
const mark = marker();
const where = getSite();
const action = `${formsAddress(where?.site ?? { forms: '' })}/send`;
const id = (name: string): string => `f-${block.id}-${name}`;
const language = where?.site.language ?? 'en';
const words = wordsFor(language);
const found = $derived(where?.site.formDefs?.[formOf(block)]);
const form = $derived(found ? formIn(found, language) : null);
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
{#if c.intro || editing}<p class="lead" data-edit={mark('intro')} data-multiline={mark('1')}>{c.intro}</p>{/if}
{#if form}
  <p class="form-note form-sent" id={id('sent')} role="status">{form.sent}</p>
  <p class="form-note form-failed" id={id('failed')} role="alert">{form.failed}</p>
  <form class="form" method="post" action={editing ? undefined : action} accept-charset="utf-8" data-form={form.name}>
    <input type="hidden" name="back" value={where?.path ?? '/'} />
    <input type="hidden" name="form" value={block.id} />
    <!-- Left empty by people; a robot that fills every field gives itself away. -->
    <p class="form-trap" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off" /></label></p>
    {#each form.fields as field (field.id)}
      {#if field.kind === 'radio' || field.kind === 'checkboxes'}
        <fieldset class="form-field">
          <legend>{field.label}{#if field.required}<span class="form-required" aria-hidden="true">*</span>{/if}</legend>
          {#each field.options as option, i (option)}
            <label class="form-choice">
              <input type={field.kind === 'radio' ? 'radio' : 'checkbox'} name={field.id} value={option} required={field.kind === 'radio' && field.required} disabled={editing} />
              {field.shown[i]}
            </label>
          {/each}
        </fieldset>
      {:else}
        <p class="form-field">
          <label for={id(field.id)}>{field.label}{#if field.required}<span class="form-required" aria-hidden="true">*</span>{/if}</label>
          {#if field.kind === 'textarea'}
            <textarea id={id(field.id)} name={field.id} rows="6" maxlength="5000" required={field.required} disabled={editing}></textarea>
          {:else if field.kind === 'select'}
            <select id={id(field.id)} name={field.id} required={field.required} disabled={editing}>
              <option value="">{words.formChoose}</option>
              {#each field.options as option, i (option)}<option value={option}>{field.shown[i]}</option>{/each}
            </select>
          {:else if field.kind === 'email'}
            <input id={id(field.id)} name={field.id} type="email" maxlength="254" autocomplete="email" required={field.required} disabled={editing} />
          {:else if field.kind === 'phone'}
            <input id={id(field.id)} name={field.id} type="tel" maxlength="40" autocomplete="tel" required={field.required} disabled={editing} />
          {:else if field.kind === 'number'}
            <input id={id(field.id)} name={field.id} type="number" step="any" required={field.required} disabled={editing} />
          {:else if field.kind === 'date'}
            <input id={id(field.id)} name={field.id} type="date" required={field.required} disabled={editing} />
          {:else}
            <input id={id(field.id)} name={field.id} type="text" maxlength="200" autocomplete={field.id === 'name' ? 'name' : undefined} required={field.required} disabled={editing} />
          {/if}
        </p>
      {/if}
    {/each}
    <p class="form-consent"><input id={id('consent')} name="consent" type="checkbox" value="yes" required disabled={editing} /><label for={id('consent')}>{form.consent}</label></p>
    <p><button class="button" type={editing ? 'button' : 'submit'}>{form.button}</button></p>
  </form>
{:else if editing}
  <p class="form-note shown" data-form-missing>{words.formMissing}</p>
{/if}
