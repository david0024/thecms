<script lang="ts">
/**
 * Before publishing (ADR 0029): the published site, read as an export would
 * write it, for links that lead nowhere and pictures with no description.
 */
import { api } from './api.ts';
import { say, t } from './messages.ts';

type Check = Awaited<ReturnType<typeof api.check>>['check'];
let check = $state.raw<Check | null>(null);
let problem = $state('');
let working = $state(false);

const pages = (list: string[]): string => list.join(', ');

async function run(): Promise<void> {
  working = true;
  problem = '';
  try {
    check = (await api.check()).check;
  } catch (error) {
    check = null;
    problem = error instanceof Error ? error.message : String(error);
  } finally {
    working = false;
  }
}
</script>

<section class="check" data-site-check>
  <h2>{t.check.heading}</h2>
  <button type="button" onclick={run} disabled={working} data-check-run>{working ? t.check.working : t.check.run}</button>
  {#if problem}<p class="bad" role="alert">{problem}</p>{/if}
  {#if check}
    {#if check.broken.length === 0 && check.unnamed.length === 0}
      <p class="good" data-check-fine>{t.check.fine}</p>
    {/if}
    {#if check.broken.length}
      <p class="bad">{t.check.broken}</p>
      <ul data-check-broken>
        {#each check.broken as link (link.href)}<li><code>{link.href}</code> <small>{say(t.check.from, { pages: pages(link.from) })}</small></li>{/each}
      </ul>
    {/if}
    {#if check.unnamed.length}
      <p>{t.check.unnamed}</p>
      <ul data-check-unnamed>
        {#each check.unnamed as image (image.src)}<li><code>{image.src}</code> <small>{say(t.check.from, { pages: pages(image.on) })}</small></li>{/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .check { max-width: 46rem; margin: 0 2rem 2rem; padding-top: 1rem; border-top: 1px solid #e6e4ee; }
  h2 { margin: 0 0 0.5rem; font-size: 1.05rem; }
  ul { margin: 0.3rem 0 0.8rem; padding-inline-start: 1.2rem; }
  li { overflow-wrap: anywhere; }
  small { color: #6a6880; }
  .good { color: #1d6b3a; }
</style>
