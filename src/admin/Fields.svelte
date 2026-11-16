<script lang="ts">
/** A form for one block's content, generated from the fields its type declares. */
import type { Field } from '../core/index.ts';
import Self from './Fields.svelte';
import { t } from './messages.ts';
import { getPath } from './paths.ts';

let {
  fields,
  content,
  prefix = '',
  onchange,
}: { fields: Record<string, Field>; content: unknown; prefix?: string; onchange: (path: string, value: unknown) => void } = $props();

const at = (name: string): string => (prefix ? `${prefix}.${name}` : name);
const text = (name: string): string => (getPath(content, name) as string | undefined) ?? '';
const part = (name: string, key: string): string => ((getPath(content, name) as Record<string, string> | null)?.[key] ?? '') as string;
const list = (name: string): Record<string, unknown>[] => (getPath(content, name) as Record<string, unknown>[] | undefined) ?? [];
const input = (e: Event): string => (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
</script>

{#each Object.entries(fields) as [name, field] (name)}
  <div class="field">
    {#if field.kind === 'text'}
      <label>
        <span>{t.fields[name] ?? name}</span>
        {#if field.multiline}
          <textarea rows="3" maxlength={field.max} value={text(name)} oninput={(e) => onchange(at(name), input(e))}></textarea>
        {:else}
          <input type="text" maxlength={field.max} value={text(name)} oninput={(e) => onchange(at(name), input(e))} />
        {/if}
      </label>
    {:else if field.kind === 'richtext'}
      <p class="hint">{t.inspector.onPage}</p>
    {:else if field.kind === 'image'}
      <fieldset>
        <legend>{t.fields[name] ?? name}</legend>
        <label><span>{t.inspector.imageSrc}</span>
          <input type="url" value={part(name, 'src')} oninput={(e) => onchange(at(name), { src: input(e), alt: part(name, 'alt') })} />
        </label>
        <label><span>{t.inspector.imageAlt}</span>
          <input type="text" value={part(name, 'alt')} oninput={(e) => onchange(at(name), { src: part(name, 'src'), alt: input(e) })} />
        </label>
      </fieldset>
    {:else if field.kind === 'link'}
      <fieldset>
        <legend>{t.fields[name] ?? name}</legend>
        <label><span>{t.inspector.linkLabel}</span>
          <input type="text" value={part(name, 'label')} oninput={(e) => onchange(at(name), { label: input(e), href: part(name, 'href') })} />
        </label>
        <label><span>{t.inspector.linkHref}</span>
          <input type="text" value={part(name, 'href')} oninput={(e) => onchange(at(name), { label: part(name, 'label'), href: input(e) })} />
        </label>
      </fieldset>
    {:else if field.kind === 'list'}
      <fieldset>
        <legend>{t.fields[name] ?? name}</legend>
        {#each list(name) as item, i}
          <div class="item">
            <Self fields={field.item} content={item} prefix={at(`${name}.${i}`)} {onchange} />
            <button type="button" class="quiet" onclick={() => onchange(at(name), list(name).filter((_, j) => j !== i))}>{t.inspector.remove}</button>
          </div>
        {/each}
        {#if list(name).length < field.max}
          <button type="button" onclick={() => onchange(at(name), [...list(name), {}])}>{t.inspector.add}</button>
        {/if}
      </fieldset>
    {/if}
  </div>
{/each}
