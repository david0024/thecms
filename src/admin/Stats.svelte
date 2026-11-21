<script lang="ts">
/**
 * Statistics (ADR 0053): visitors and pages seen in a range, a chart, the
 * pages read most, where visitors came from, their devices and what they
 * searched for. Counted by the site's server, without a cookie. The owner and
 * the editors read it; nothing here changes anything.
 */
import { onMount } from 'svelte';
import { api, type Range, type StatsShown } from './api.ts';
import { say, t } from './messages.ts';

let range = $state<Range>('30');
let shown = $state<StatsShown | null>(null);
let problem = $state('');

/** Counts the loads, so that an answer for a range clicked earlier never replaces the last one's. */
let loads = 0;
async function load(next: Range): Promise<void> {
  const mine = ++loads;
  range = next;
  problem = '';
  try {
    const answer = await api.stats(next);
    if (mine === loads) shown = answer;
  } catch (error) {
    if (mine === loads) problem = error instanceof Error ? error.message : String(error);
  }
}
onMount(() => void load('30'));

const RANGES: { range: Range; label: () => string }[] = [
  { range: 'today', label: () => t.stats.today },
  { range: '7', label: () => t.stats.days7 },
  { range: '30', label: () => t.stats.days30 },
  { range: '365', label: () => t.stats.months12 },
];

const number = (n: number): string => n.toLocaleString();
/** A day or a month as the reader writes it. */
const dated = (at: string): string =>
  at.length === 7
    ? new Date(`${at}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : new Date(`${at}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const sourceName = (name: string): string => name || t.stats.direct;
const deviceName = (name: string): string => (name === 'phone' ? t.stats.phone : name === 'tablet' ? t.stats.tablet : t.stats.computer);

const top = $derived(Math.max(1, ...(shown?.chart ?? []).map((c) => c.views)));
const W = 600;
const H = 140;
</script>

<section class="stats" data-stats>
  <h1>{t.stats.heading}</h1>
  <p class="hint">{t.stats.intro}</p>
  <div class="ranges" role="group" aria-label={t.stats.heading}>
    {#each RANGES as r (r.range)}
      <button type="button" aria-pressed={range === r.range} onclick={() => load(r.range)} data-stats-range={r.range}>{r.label()}</button>
    {/each}
  </div>

  {#if shown}
    <div class="totals">
      <div class="total"><strong data-stats-visitors>{number(shown.visitors)}</strong><span>{t.stats.visitors}</span></div>
      <div class="total"><strong data-stats-views>{number(shown.views)}</strong><span>{t.stats.views}</span></div>
    </div>
    <p class="hint">{t.stats.visitorsHint}</p>

    {#if shown.views === 0}
      <p class="empty" data-stats-empty>{t.stats.none}</p>
    {:else if shown.chart.length > 1}
      {@const step = W / shown.chart.length}
      <svg class="chart" viewBox="0 0 {W} {H + 18}" role="img" aria-label={`${t.stats.visitors}: ${number(shown.visitors)}. ${t.stats.views}: ${number(shown.views)}.`} data-stats-chart>
        {#each shown.chart as c, i (c.at)}
          <g>
            <title>{dated(c.at)}: {number(c.visitors)} {t.stats.visitors.toLowerCase()}, {number(c.views)} {t.stats.views.toLowerCase()}</title>
            <rect class="views" x={i * step + step * 0.12} width={step * 0.76} y={H - (c.views / top) * H} height={(c.views / top) * H} />
            <rect class="visitors" x={i * step + step * 0.12} width={step * 0.76} y={H - (c.visitors / top) * H} height={(c.visitors / top) * H} />
          </g>
        {/each}
        <text x="0" y={H + 14}>{dated(shown.chart[0]?.at ?? '')}</text>
        <text x={W} y={H + 14} text-anchor="end">{dated(shown.chart[shown.chart.length - 1]?.at ?? '')}</text>
      </svg>
      <p class="legend"><span class="key visitors"></span>{t.stats.visitors} <span class="key views"></span>{t.stats.views}</p>
    {/if}

    <div class="lists">
      {#each [{ key: 'pages', heading: t.stats.pages, rows: shown.pages, name: (n: string) => n }, { key: 'sources', heading: t.stats.sources, rows: shown.sources, name: sourceName }, { key: 'devices', heading: t.stats.devices, rows: shown.devices, name: deviceName }, { key: 'searches', heading: t.stats.searches, rows: shown.searches, name: (n: string) => n }] as list (list.key)}
        {@const most = Math.max(1, ...list.rows.map((r) => r.hits))}
        <div class="list" data-stats-list={list.key}>
          <h2>{list.heading}</h2>
          {#if list.rows.length}
            <ol>
              {#each list.rows as row (row.name)}
                <li style="--share: {(row.hits / most) * 100}%"><span class="name">{list.name(row.name)}</span><span class="hits">{number(row.hits)}</span></li>
              {/each}
            </ol>
          {:else}
            <p class="hint">{t.stats.noneList}</p>
          {/if}
        </div>
      {/each}
    </div>
    <p class="hint" data-stats-zone>{say(t.stats.zone, { zone: shown.zone })}</p>
  {/if}
  {#if problem}<p class="bad" role="alert">{problem}</p>{/if}
</section>

<style>
  .stats { max-width: 920px; padding: 1.5rem 2rem; }
  h1 { font-size: 20px; margin: 0 0 0.4rem; }
  h2 { font-size: 14px; margin: 0 0 0.5rem; }
  .hint { color: #555; font-size: 13px; }
  .ranges { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.8rem 0; }
  .ranges button[aria-pressed='true'] { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
  .totals { display: flex; flex-wrap: wrap; gap: 1rem; }
  .total { display: grid; padding: 0.8rem 1.2rem; border: 1px solid #ddd; border-radius: 6px; min-width: 150px; }
  .total strong { font-size: 28px; }
  .total span { font-size: 13px; color: #555; }
  .empty { padding: 1.5rem; border: 1px dashed #ccc; border-radius: 6px; text-align: center; color: #555; font-size: 14px; }
  .chart { width: 100%; height: auto; margin-top: 0.5rem; }
  .chart rect.views { fill: #bfdbfe; }
  .chart rect.visitors { fill: #1d4ed8; }
  .chart text { font-size: 11px; fill: #555; }
  .legend { font-size: 12px; color: #555; display: flex; align-items: center; gap: 0.3rem; }
  .key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-left: 0.6rem; }
  .key.visitors { background: #1d4ed8; margin-left: 0; }
  .key.views { background: #bfdbfe; }
  .lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.2rem; margin-top: 1.4rem; }
  .list ol { list-style: none; padding: 0; margin: 0; }
  .list li {
    display: flex; justify-content: space-between; gap: 0.6rem; padding: 0.3rem 0.5rem; margin-bottom: 2px; font-size: 13px; border-radius: 4px;
    background: linear-gradient(to right, #eff6ff var(--share), transparent var(--share));
  }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hits { font-variant-numeric: tabular-nums; color: #333; }
  .bad { color: #b42318; font-size: 13px; }
</style>
