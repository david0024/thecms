<script lang="ts">
/**
 * Orders (ADR 0065 d7): each order placed in the shop, by state, the newest
 * first; an order's page with its lines, its buyer, how it is paid and
 * delivered, its state and tracking number; and every order as a CSV file.
 * The owner's, and the editors' when the owner allows it.
 */
import { onMount } from 'svelte';
import { moneyText, ORDER_STATES, type OrderState } from '../core/index.ts';
import { api, type Order, type OrderListed } from './api.ts';
import { adminLanguage, say, t } from './messages.ts';

let orders = $state.raw<OrderListed[] | null>(null);
let filter = $state('');
let open = $state.raw<Order | null>(null);
let chosen = $state<OrderState>('waiting');
let tracking = $state('');
let problem = $state('');
let note = $state('');

const money = (n: number, currency: string): string => moneyText(n, currency, adminLanguage());
const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const stateName = (s: OrderState): string => t.orders.states[s];

const attempt = async (work: () => Promise<void>): Promise<void> => {
  problem = '';
  try {
    await work();
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
    note = '';
  }
};
const list = (): Promise<void> =>
  attempt(async () => {
    orders = (await api.orders(filter)).orders;
  });
const show = (id: string): Promise<void> =>
  attempt(async () => {
    open = (await api.order(id)).order;
    chosen = open.state;
    tracking = open.data.tracking;
    note = '';
  });
const save = (): Promise<void> =>
  attempt(async () => {
    if (!open) return;
    open = (await api.setOrder(open.id, { state: chosen, tracking })).order;
    note = t.orders.saved;
  });
const back = (): void => {
  open = null;
  void list();
};

async function csv(): Promise<void> {
  await attempt(async () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await api.ordersFile());
    link.download = 'orders.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

onMount(() => void list());
</script>

<section class="orders">
  <h2>{t.orders.heading}</h2>
  {#if open}
    {@const o = open}
    <p><button type="button" class="quiet" onclick={back} data-orders-back>← {t.orders.back}</button></p>
    <h3 data-order-number>{t.orders.number} {o.number}</h3>
    <p class="hint">{when(o.createdAt)} · {o.data.payment === 'transfer' ? t.orders.transfer : t.orders.cod}</p>
    <h4>{t.orders.lines}</h4>
    <table>
      <tbody>
        {#each o.data.lines as l, i (i)}
          <tr><td>{l.quantity} ×</td><td>{l.name}{l.variant ? ` (${l.variant})` : ''}{l.sku ? ` · ${l.sku}` : ''}</td><td class="n">{money(l.price * l.quantity, o.data.currency)}</td></tr>
        {/each}
        {#if o.data.totals.discount}<tr><td></td><td>{say(t.orders.coupon, { code: o.data.totals.coupon ?? '' })}</td><td class="n" data-order-discount>−{money(o.data.totals.discount, o.data.currency)}</td></tr>{/if}
        <tr><td></td><td>{t.orders.delivery}: {o.data.shipping.name}</td><td class="n">{money(o.data.totals.shipping, o.data.currency)}</td></tr>
        <tr class="total"><td></td><td>{t.orders.total}</td><td class="n" data-order-total>{money(o.data.totals.total, o.data.currency)}</td></tr>
      </tbody>
    </table>
    <h4>{t.orders.buyer}</h4>
    <p>
      {o.data.buyer.name} · <a href={`mailto:${o.email}`}>{o.email}</a> · {o.data.buyer.phone}<br />
      {o.data.shipping.pickup ? o.data.shipping.pickup : [o.data.buyer.street, o.data.buyer.postcode, o.data.buyer.town, o.data.buyer.county].filter(Boolean).join(', ')}
    </p>
    {#if o.data.buyer.company}<p>{t.orders.company}: {o.data.buyer.company.name} · {o.data.buyer.company.taxCode}{o.data.buyer.company.registration ? ` · ${o.data.buyer.company.registration}` : ''}</p>{/if}
    {#if o.data.note}<p>{t.orders.note}: {o.data.note}</p>{/if}

    <h4>{t.orders.state}</h4>
    {#if o.state === 'cancelled' || o.state === 'refunded'}
      <p data-order-state={o.state}><strong>{stateName(o.state)}</strong> · {t.orders.final}</p>
    {:else}
      <div class="row">
        <select bind:value={chosen} data-order-state={o.state}>
          {#each ORDER_STATES as s (s)}<option value={s}>{stateName(s)}</option>{/each}
        </select>
        <input type="text" maxlength="100" placeholder={t.orders.tracking} aria-label={t.orders.tracking} bind:value={tracking} data-order-tracking />
        <button type="button" class="primary" onclick={save} data-order-save>{t.orders.save}</button>
      </div>
      {#if chosen === 'cancelled'}<small>{t.orders.cancelHint}</small>{/if}
    {/if}
    {#if note}<p role="status">{note}</p>{/if}
    <h4>{t.orders.history}</h4>
    <ul class="history">{#each o.data.history as h, i (i)}<li>{when(h.at)}: {stateName(h.state)}</li>{/each}</ul>
  {:else}
    <p class="hint">{t.orders.intro}</p>
    <div class="row">
      <select bind:value={filter} onchange={list} aria-label={t.orders.state} data-orders-filter>
        <option value="">{t.orders.all}</option>
        {#each ORDER_STATES as s (s)}<option value={s}>{stateName(s)}</option>{/each}
      </select>
      <button type="button" onclick={csv} data-orders-csv>{t.orders.csv}</button>
    </div>
    {#if orders && !orders.length}
      <p data-orders-none>{t.orders.none}</p>
    {:else if orders}
      <table data-orders>
        <thead><tr><th>{t.orders.number}</th><th>{t.orders.date}</th><th>{t.orders.buyer}</th><th class="n">{t.orders.total}</th><th>{t.orders.state}</th></tr></thead>
        <tbody>
          {#each orders as o (o.id)}
            <tr>
              <td><button type="button" class="link" onclick={() => show(o.id)} data-order-open={o.number}>{o.number}</button></td>
              <td>{when(o.createdAt)}</td>
              <td>{o.name}<br /><small>{o.email}</small></td>
              <td class="n">{money(o.total, o.currency)}</td>
              <td>{stateName(o.state)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
  {#if problem}<p class="bad" role="alert">{problem}</p>{/if}
</section>

<style>
  .orders { max-width: 56rem; margin: 0 auto; padding: 1rem; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: start; padding: 0.35rem 0.4rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .n { text-align: end; white-space: nowrap; }
  .total td { font-weight: 600; }
  .row { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; margin: 0.4rem 0; }
  .link { background: none; border: 0; padding: 0; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; }
  .history { font-size: 12px; }
  .bad { color: #b42318; }
</style>
