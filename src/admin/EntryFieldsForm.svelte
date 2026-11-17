<script lang="ts">
/** The form for what an entry's content type asks for besides the usual (ADR 0010): one input for each field, by its kind. */
import type { ContentType, ImageValue, LinkValue } from '../core/index.ts';
import ImageField from './ImageField.svelte';
import { t } from './messages.ts';

let { type, values, onchange }: { type: ContentType; values: Record<string, unknown>; onchange: (values: Record<string, unknown>) => void } = $props();

const set = (key: string, value: unknown): void => onchange({ ...values, [key]: value });
const text = (key: string): string => (typeof values[key] === 'string' ? (values[key] as string) : '');
const link = (key: string): LinkValue => ({ label: '', href: '', ...((values[key] as LinkValue | null) ?? {}) });
</script>

{#each type.fields as field (field.key)}
  <div class="field" data-entry-field={field.key}>
    {#if field.kind === 'image'}
      <ImageField label={field.label} value={(values[field.key] as ImageValue | null) ?? null} onchange={(image) => set(field.key, image.src ? image : null)} />
    {:else if field.kind === 'link'}
      <fieldset>
        <legend>{field.label}</legend>
        <label><span>{t.inspector.linkLabel}</span><input type="text" maxlength="80" value={link(field.key).label} oninput={(e) => set(field.key, { ...link(field.key), label: e.currentTarget.value })} /></label>
        <label><span>{t.inspector.linkHref}</span><input type="text" value={link(field.key).href} placeholder="https://… /contact/" onchange={(e) => set(field.key, { ...link(field.key), href: e.currentTarget.value.trim() })} /></label>
      </fieldset>
    {:else}
      <label>
        <span>{field.label}</span>
        {#if field.kind === 'longtext'}
          <textarea rows="3" maxlength="2000" value={text(field.key)} onchange={(e) => set(field.key, e.currentTarget.value)}></textarea>
        {:else if field.kind === 'date'}
          <input type="date" value={text(field.key)} onchange={(e) => set(field.key, e.currentTarget.value)} />
        {:else}
          <input type="text" maxlength="300" value={text(field.key)} onchange={(e) => set(field.key, e.currentTarget.value)} />
        {/if}
      </label>
    {/if}
  </div>
{/each}
