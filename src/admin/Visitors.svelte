<script lang="ts">
/**
 * Settings → Visitor accounts (ADR 0064 d2, d6, d8): one switch, who may make
 * an account, and, once on, the accounts, invitations, each visitor's data
 * and the messages that could not be sent. While off, nothing else is shown.
 */
import { onMount } from 'svelte';
import { api, type VisitorsShown } from './api.ts';
import { say, t } from './messages.ts';

let { languages = [] }: { languages?: string[] } = $props();
let shown = $state<VisitorsShown | null>(null);
let problem = $state('');
let email = $state('');
let name = $state('');
let language = $state('');
const day = (at: string | null): string => (at ? new Date(at).toLocaleDateString() : '');

async function load(call: () => Promise<VisitorsShown>): Promise<void> {
  try {
    shown = await call();
    problem = '';
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
}
onMount(() => load(api.visitors));

async function invite(): Promise<void> {
  await load(() => api.inviteVisitor(email.trim(), name.trim(), language || (languages[0] ?? '')));
  if (!problem) {
    email = '';
    name = '';
  }
}

async function download(id: string, address: string): Promise<void> {
  const { visitor } = await api.visitorData(id);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(visitor, null, 2)], { type: 'application/json' }));
  link.download = `${address}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
</script>

<h3>{t.visitors.heading}</h3>
{#if shown}
  <p class="hint">{t.visitors.intro}</p>
  <label class="check">
    <input type="checkbox" checked={shown.settings.on} onchange={(e) => load(() => api.setVisitors({ on: e.currentTarget.checked }))} data-visitors-on />
    <span>{t.visitors.on}</span>
  </label>
  {#if !shown.settings.on}
    <small>{t.visitors.offHint}</small>
  {:else}
    <small>{say(t.visitors.pages, { address: '/_/account' })}</small>
    <label class="field">
      <span>{t.visitors.signup}</span>
      <select value={shown.settings.signup} onchange={(e) => load(() => api.setVisitors({ signup: e.currentTarget.value as 'open' | 'invite' | 'closed' }))} data-visitors-signup>
        <option value="open" disabled={!shown.mail}>{t.visitors.open}</option>
        <option value="invite">{t.visitors.invite}</option>
        <option value="closed">{t.visitors.closed}</option>
      </select>
      {#if !shown.mail}<small>{t.visitors.openNeedsMail}</small>{/if}
    </label>
    <label class="field">
      <span>{t.visitors.privacy}</span>
      <input type="text" value={shown.settings.privacy} placeholder="/privacy/" onchange={(e) => load(() => api.setVisitors({ privacy: e.currentTarget.value.trim() }))} data-visitors-privacy />
      <small>{t.visitors.privacyHint}</small>
    </label>
    {#if !shown.mail}<p class="bad">{t.visitors.noMail}</p>{/if}

    <h4>{t.visitors.list}</h4>
    {#if shown.waiting}<p class="hint" data-visitors-waiting>{say(t.visitors.waiting, { count: shown.waiting })}</p>{/if}
    {#if shown.visitors?.length}
      <ul class="list" data-visitors-list>
        {#each shown.visitors as v (v.id)}
          <li data-visitor={v.email}>
            <span class="grow">
              <strong>{v.name || v.email}</strong>
              {#if v.name}<small>{v.email}</small>{/if}
              <small>
                {v.invited ? t.visitors.invited : !v.confirmedAt ? t.visitors.unconfirmed : say(t.visitors.since, { date: day(v.confirmedAt) })}
                {#if v.lastAt} · {say(t.visitors.lastSeen, { date: day(v.lastAt) })}{/if}
              </small>
            </span>
            <button type="button" class="quiet" onclick={() => download(v.id, v.email)}>{t.visitors.download}</button>
            <button type="button" class="quiet" onclick={() => confirm(say(t.visitors.removeConfirm, { email: v.email })) && load(() => api.removeVisitor(v.id))} data-visitor-remove>{t.visitors.remove}</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint">{t.visitors.none}</p>
    {/if}

    {#if shown.settings.signup !== 'closed' && shown.mail}
      <fieldset class="field" data-visitors-invite>
        <legend>{t.visitors.inviteHeading}</legend>
        <label><span>{t.visitors.email}</span><input type="email" maxlength="254" bind:value={email} data-invite-email /></label>
        <label><span>{t.visitors.name}</span><input type="text" maxlength="120" bind:value={name} /></label>
        {#if languages.length > 1}
          <label><span>{t.visitors.language}</span>
            <select bind:value={language}>{#each languages as l (l)}<option value={l}>{l}</option>{/each}</select>
          </label>
        {/if}
        <button type="button" onclick={invite} disabled={!email.trim()} data-invite-send>{t.visitors.send}</button>
      </fieldset>
    {/if}

    {#if shown.failed?.length}
      <h4 class="bad">{t.visitors.failed}</h4>
      <ul class="list" data-visitors-failed>
        {#each shown.failed as f (f.id)}
          <li>
            <span class="grow"><strong>{f.to}</strong> <small>{f.what} · {day(f.failedAt)} · {f.error}</small></span>
            <button type="button" class="quiet" onclick={() => load(() => api.retryMail(f.id))}>{t.visitors.retry}</button>
            <button type="button" class="quiet" onclick={() => load(() => api.forgetMail(f.id))}>{t.visitors.forget}</button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
{/if}
{#if problem}<p class="bad" role="alert">{problem}</p>{/if}

<style>
  h3 { margin: 1.1rem 0 0.5rem; font-size: 13px; }
  h4 { margin: 0.8rem 0 0.3rem; font-size: 12px; }
  .field { display: grid; gap: 0.15rem; font-size: 12px; margin-top: 0.5rem; }
  .check { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.3rem; }
  .check span { margin: 0; }
  .list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.3rem; font-size: 12px; }
  .list li { display: flex; align-items: center; gap: 0.4rem; }
  .list small { display: block; }
  .grow { flex: 1; min-width: 0; }
  p { font-size: 13px; }
  .bad { color: #b42318; }
</style>
