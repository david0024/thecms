<script lang="ts">
/**
 * Me (ADR 0055 d3): the name the site shows under what someone writes, and a
 * few words about them at the end of their posts. Each person sets their own.
 */
import { api, type State } from './api.ts';
import { t } from './messages.ts';

let { me, onsaved }: { me: State['me']; onsaved: (state: State) => void } = $props();

// svelte-ignore state_referenced_locally
let name = $state(me.name);
// svelte-ignore state_referenced_locally
let bio = $state(me.bio);
let problem = $state('');
let saved = $state(false);

async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  problem = '';
  saved = false;
  try {
    onsaved(await api.setProfile(name, bio));
    saved = true;
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
}
</script>

<section class="screen" data-list="me">
  <h1>{t.me.heading}</h1>
  <p class="hint">{t.me.intro}</p>
  <form onsubmit={save} data-profile>
    <label class="field">
      <span>{t.me.name}</span>
      <input type="text" maxlength="120" bind:value={name} oninput={() => (saved = false)} data-profile-name />
    </label>
    <label class="field">
      <span>{t.me.bio}</span>
      <textarea rows="4" maxlength="300" bind:value={bio} oninput={() => (saved = false)} data-profile-bio></textarea>
      <small>{t.me.bioHint}</small>
    </label>
    <button type="submit" class="primary">{t.me.save}</button>
    {#if saved}<span role="status" data-profile-saved>{t.me.saved}</span>{/if}
    {#if problem}<p class="bad" role="alert">{problem}</p>{/if}
  </form>
</section>

<style>
  h1 { margin: 0 0 0.5rem; font-size: 1.4rem; }
  form { max-width: 36rem; display: grid; gap: 0.8rem; justify-items: start; }
  form .field { width: 100%; }
</style>
