<script lang="ts">
/**
 * What visitors sent through the site's forms (ADR 0019): read, answer by
 * email, delete. A visitor's right to see or erase what they sent is answered
 * here too: everything one address sent, messages and comments (ADR 0040),
 * can be downloaded, or erased at once.
 */
import { onMount } from 'svelte';
import { api, type Comment, type Message } from './api.ts';
import { say, t } from './messages.ts';

let items = $state.raw<Message[] | null>(null);
let keep = $state(180);
let problem = $state('');
let who = $state('');

const attempt = async (work: () => Promise<{ messages: Message[]; keep: number }>): Promise<void> => {
  problem = '';
  try {
    const answer = await work();
    items = answer.messages;
    keep = answer.keep;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
};

const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const subject = (m: Message): string => encodeURIComponent(`Re: ${m.body.slice(0, 60)}`);

function download(kept: { messages: Message[]; comments: Comment[] }, name: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify({ messages: kept.messages, comments: kept.comments }, null, 2)], { type: 'application/json' }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

onMount(() => void attempt(api.messages));
</script>

<section class="screen" data-list="messages">
  <header>
    <h1>{t.inbox.heading}</h1>
  </header>
  <p class="hint">{say(t.inbox.intro, { count: keep })}</p>
  {#if problem}<p class="bad" role="alert">{problem}</p>{/if}
  {#if items && items.length === 0}
    <p class="hint">{t.inbox.empty}</p>
  {:else if items}
    <ul class="messages">
      {#each items as m (m.id)}
        <li data-message={m.id}>
          <p class="from"><strong>{m.name}</strong> <a href={`mailto:${m.email}?subject=${subject(m)}`}>{m.email}</a> <small>{when(m.receivedAt)} · {m.page}</small></p>
          <p class="body">{m.body}</p>
          <details><summary>{t.inbox.consent}</summary><p>{m.consent}</p></details>
          <button type="button" class="quiet" onclick={() => attempt(() => api.removeMessage(m.id))} data-message-delete>{t.inbox.remove}</button>
        </li>
      {/each}
    </ul>
  {/if}

  <h2>{t.inbox.rights}</h2>
  <p class="hint">{t.inbox.rightsHint}</p>
  <div class="rights">
    <input type="email" placeholder={t.inbox.address} bind:value={who} data-rights-email />
    <button type="button" disabled={!who.trim()} onclick={async () => download(await api.messagesFrom(who), `kept-about-${who.trim()}.json`)} data-rights-export>{t.inbox.export}</button>
    <button type="button" class="quiet" disabled={!who.trim()} onclick={() => attempt(() => api.eraseMessagesFrom(who))} data-rights-erase>{t.inbox.erase}</button>
  </div>
</section>

<style>
  header { margin-bottom: 0.5rem; }
  h1 { margin: 0; font-size: 1.4rem; }
  h2 { margin: 2rem 0 0.3rem; font-size: 1.05rem; }
  .messages { list-style: none; margin: 1rem 0 0; padding: 0; display: grid; gap: 0.8rem; max-width: 46rem; }
  .messages li { padding: 1rem 1.2rem; background: #fff; border: 1px solid #dddbe6; border-radius: 8px; }
  .from { margin: 0 0 0.4rem; display: flex; flex-wrap: wrap; gap: 0.3rem 0.8rem; align-items: baseline; }
  .from small { color: #6a6880; }
  .body { margin: 0 0 0.5rem; white-space: pre-line; }
  details { font-size: 0.85rem; color: #6a6880; margin-bottom: 0.5rem; }
  .rights { display: flex; flex-wrap: wrap; gap: 0.5rem; max-width: 46rem; }
  .rights input { flex: 1 1 16rem; }
</style>
