<script lang="ts">
/**
 * Me (ADR 0055 d3, ADR 0056 d2): the name the site shows under what someone
 * writes, a few words about them and their picture, at the end of their posts
 * and on their page. Each person sets their own.
 */
import { api, type State } from './api.ts';
import ImageField from './ImageField.svelte';
import { t } from './messages.ts';

let { me, onsaved }: { me: State['me']; onsaved: (state: State) => void } = $props();

// svelte-ignore state_referenced_locally
let name = $state(me.name);
// svelte-ignore state_referenced_locally
let bio = $state(me.bio);
// svelte-ignore state_referenced_locally
let picture = $state(me.picture);
let problem = $state('');
let saved = $state(false);

async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  problem = '';
  saved = false;
  try {
    onsaved(await api.setProfile(name, bio, picture));
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
    <div class="field" data-profile-picture>
      <ImageField label={t.me.picture} value={picture ? { src: picture, alt: name } : null} onchange={(value) => ((picture = value.src), (saved = false))} library />
    </div>
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
