<script lang="ts">
/**
 * Old addresses that lead to new ones (ADR 0036): those an import brought,
 * those made when a page moved, and those the owner writes here. Each change
 * is kept at once; the site cleans what it is given.
 */
import { onMount } from 'svelte';
import type { Redirect } from '../core/index.ts';
import { api } from './api.ts';
import { t } from './messages.ts';

let redirects = $state<Redirect[]>([]);
let from = $state('');
let to = $state('');
let problem = $state('');

onMount(async () => {
  try {
    redirects = (await api.redirects()).redirects;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
});

async function keep(next: Redirect[]): Promise<boolean> {
  try {
    const before = next.length;
    redirects = (await api.setRedirects(next)).redirects;
    problem = redirects.length < before ? t.redirects.refused : '';
    return true;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
    return false;
  }
}

async function add(): Promise<void> {
  const path = (value: string): string => (value.trim().startsWith('/') ? value.trim() : `/${value.trim()}`);
  if (!from.trim() || !to.trim()) return;
  if (await keep([...redirects.filter((r) => r.from !== path(from)), { from: path(from), to: path(to) }])) from = to = '';
}
</script>

<h3>{t.redirects.heading}</h3>
<p class="hint">{t.redirects.intro}</p>
{#if redirects.length}
  <ul class="redirects" data-redirects>
    {#each redirects as redirect (redirect.from)}
      <li data-redirect={redirect.from}>
        <code>{redirect.from}</code> → <code>{redirect.to}</code>
        <button type="button" class="quiet" title={t.redirects.remove} aria-label={t.redirects.remove} onclick={() => keep(redirects.filter((r) => r.from !== redirect.from))} data-redirect-remove={redirect.from}>✕</button>
      </li>
    {/each}
  </ul>
{/if}
<form
  class="add"
  onsubmit={(e) => {
    e.preventDefault();
    add();
  }}
>
  <label><span>{t.redirects.from}</span><input type="text" bind:value={from} placeholder="/servicii/" data-redirect-from /></label>
  <label><span>{t.redirects.to}</span><input type="text" bind:value={to} placeholder="/ce-facem/" data-redirect-to /></label>
  <button type="submit" disabled={!from.trim() || !to.trim()} data-redirect-add>{t.redirects.add}</button>
</form>
{#if problem}<p class="bad" role="alert">{problem}</p>{/if}

<style>
  h3 { margin: 1.1rem 0 0.5rem; font-size: 13px; }
  .redirects { list-style: none; padding: 0; margin: 0 0 0.5rem; display: grid; gap: 0.25rem; font-size: 13px; }
  .redirects li { display: flex; align-items: center; gap: 0.35rem; overflow-wrap: anywhere; }
  .redirects button { margin-inline-start: auto; padding: 0 0.4rem !important; }
  .add { display: grid; gap: 0.4rem; }
  .add label { display: grid; gap: 0.15rem; font-size: 12px; }
  .bad { color: #b42318; font-size: 13px; }
</style>
