<script lang="ts">
/**
 * Settings → Shop (ADR 0065 d5, d10): one switch, whether the site charges
 * VAT, and its rates. While off, nothing else is shown, and nothing of the
 * shop is loaded on the server.
 */
import type { ShopSettings } from '../core/index.ts';
import { api } from './api.ts';
import { t } from './messages.ts';

let { settings, onchange }: { settings: ShopSettings; /** Told once the server has saved: turning the shop on may add a type. */ onchange: () => void } = $props();
let problem = $state('');

async function save(patch: Partial<ShopSettings>): Promise<void> {
  try {
    await api.setShop(patch);
    problem = '';
    onchange();
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
}
const rates = (typed: string): number[] => typed.split(/[;,\s]+/).filter(Boolean).map((r) => Number(r.replace(',', '.')));
</script>

<h3>{t.shop.heading}</h3>
<p class="hint">{t.shop.intro}</p>
<label class="check">
  <input type="checkbox" checked={settings.on} onchange={(e) => save({ on: e.currentTarget.checked })} data-shop-on />
  <span>{t.shop.on}</span>
</label>
{#if !settings.on}
  <small>{t.shop.offHint}</small>
{:else}
  <small>{t.shop.onHint}</small>
  <label class="check">
    <input type="checkbox" checked={settings.vat} onchange={(e) => save({ vat: e.currentTarget.checked })} data-shop-vat />
    <span>{t.shop.vat}</span>
  </label>
  <small>{t.shop.vatHint}</small>
  {#if settings.vat}
    <label class="field">
      <span>{t.shop.rates}</span>
      <input type="text" value={settings.rates.join(', ')} onchange={(e) => save({ rates: rates(e.currentTarget.value) })} data-shop-rates />
      <small>{t.shop.ratesHint}</small>
    </label>
  {/if}
  <small>{t.shop.staticHint}</small>
{/if}
{#if problem}<p class="bad" role="alert">{problem}</p>{/if}

<style>
  h3 { margin: 1.1rem 0 0.5rem; font-size: 13px; }
  .field { display: grid; gap: 0.15rem; font-size: 12px; margin-top: 0.5rem; }
  .check { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.3rem; }
  .check span { margin: 0; }
  p { font-size: 13px; }
  .bad { color: #b42318; }
</style>
