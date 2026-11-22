<script lang="ts">
/** Plans side by side: a name, a price, what it includes (one feature a line), and a button. */
import { type Block, isLink, type PricingContent, relOf } from '../core/index.ts';
import { isEditing, marker } from './editing.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as PricingContent);
const editing = isEditing();
const mark = marker();
const lines = (text: string): string[] => text.split('\n').map((line) => line.trim()).filter(Boolean);
// In the editor a button shows as soon as it has words, so it can be seen while its address is still missing.
const shown = (link: PricingContent['plans'][number]['action']): link is NonNullable<typeof link> => (editing ? !!link?.label : isLink(link));
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
{#if c.intro || editing}<p class="lead" data-edit={mark('intro')} data-multiline={mark('1')}>{c.intro}</p>{/if}
<ul class="cards plans">
  {#each c.plans as plan, i}
    <li class="card plan">
      <h3 data-edit={mark(`plans.${i}.name`)}>{plan.name}</h3>
      {#if plan.price || plan.period || editing}
        <p class="plan-price">
          <strong data-edit={mark(`plans.${i}.price`)}>{plan.price}</strong>
          {#if plan.period || editing}<span data-edit={mark(`plans.${i}.period`)}>{plan.period}</span>{/if}
        </p>
      {/if}
      {#if plan.text || editing}<p data-edit={mark(`plans.${i}.text`)} data-multiline={mark('1')}>{plan.text}</p>{/if}
      {#if editing}
        <p class="lines plan-features" data-edit={mark(`plans.${i}.features`)} data-multiline={mark('1')}>{plan.features}</p>
      {:else if lines(plan.features).length}
        <ul class="plan-features">
          {#each lines(plan.features) as feature}<li>{feature}</li>{/each}
        </ul>
      {/if}
      {#if shown(plan.action)}<p class="plan-action"><a class="button" href={plan.action.href || undefined} rel={relOf(plan.action)}><span data-edit={mark(`plans.${i}.action.label`)}>{plan.action.label}</span></a></p>{/if}
    </li>
  {/each}
</ul>
