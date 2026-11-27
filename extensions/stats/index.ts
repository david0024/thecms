/**
 * Statistics without a cookie (ADR 0053), as an extension (ADR 0062 d8). The
 * program tells what it read of each visit, in batches; this adds them to the
 * day's totals and its month's, and shows them in a report. It never learns
 * who made a visit: the program keeps the fingerprint and tells only whether
 * the visitor is new today.
 */
import { DAYS_KEPT, type Kind, summed } from './rows.ts';

type Host = import('../../src/site/extension-runner.ts').ExtensionHost;
type Range = 'today' | '7' | '30' | '365';

interface Served {
  day: string;
  path: string;
  /** `''` came directly, null came from another page of the site. */
  source: string | null;
  device: string;
  /** The visitor's first page today. */
  first: boolean;
}

/** How many of each list the report shows. */
const TOP = 10;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Adds the totals, one call for each row however many visits a batch holds. */
async function add(host: Host, totals: { day: string; kind: Kind; name: string; hits: number }[]): Promise<void> {
  for (const one of summed(totals)) await host.collections.add(one.collection, one.id, { hits: one.hits }, one.row);
}

/** The day a moment is in, in a time zone, as YYYY-MM-DD. A zone that is not one is UTC. */
export function dayIn(zone: string, at: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/** The days of a range, from the oldest, ending on `last`. */
export function daysOf(range: Range, last: string): string[] {
  const count = range === 'today' ? 1 : Number(range);
  const end = Date.parse(`${last}T12:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** The 12 months ending with the one `last` is in, from the oldest. */
export function monthsOf(last: string): string[] {
  const [year, month] = last.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const at = new Date(Date.UTC(year, month - 12 + i, 1));
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

const DEVICES: Record<string, string> = { phone: 'Phone', tablet: 'Tablet', computer: 'Computer' };

export const actions = {
  /** Pages sent to visitors. */
  async served(input: { items: Served[] }, host: Host) {
    const totals: { day: string; kind: Kind; name: string; hits: number }[] = [];
    for (const item of input.items ?? []) {
      if (!DAY.test(String(item.day))) continue;
      const day = item.day;
      totals.push({ day, kind: 'views', name: '', hits: 1 }, { day, kind: 'page', name: String(item.path ?? ''), hits: 1 });
      // An arrival from elsewhere is counted each time; coming directly, once a day.
      if (item.source || (item.source === '' && item.first)) totals.push({ day, kind: 'source', name: String(item.source), hits: 1 });
      if (item.first) totals.push({ day, kind: 'visitors', name: '', hits: 1 }, { day, kind: 'device', name: String(item.device ?? ''), hits: 1 });
    }
    await add(host, totals);
  },

  /** Words searched for with the site's search. */
  async searched(input: { items: { day: string; words: string }[] }, host: Host) {
    await add(
      host,
      (input.items ?? []).filter((item) => DAY.test(String(item.day)) && item.words).map((item) => ({ day: item.day, kind: 'search' as const, name: String(item.words), hits: 1 })),
    );
  },

  /** Once a day: the days older than a month go; their months stay. */
  async forget(input: { at?: string }, host: Host) {
    const now = Date.parse(input.at ?? '') || Date.now();
    const oldest = new Date(now - (DAYS_KEPT + 1) * 86_400_000).toISOString().slice(0, 10);
    for (const row of await host.collections.list('days')) if (String(row.day) < oldest) await host.collections.delete('days', String(row.id));
  },

  /** The report (ADR 0062 d7): today, 7 or 30 days from the days, 12 months from the months. */
  async report(input: { range?: string; timeZone?: string; now?: number }, host: Host) {
    const range: Range = (['today', '7', '30', '365'] as const).find((r) => r === input.range) ?? '30';
    const today = dayIn(String(input.timeZone ?? 'UTC'), typeof input.now === 'number' ? input.now : Date.now());
    const byMonth = range === '365';
    const slots = byMonth ? monthsOf(today) : daysOf(range, today);
    const chart = new Map(slots.map((at) => [at, { visitors: 0, views: 0 }]));
    const lists: Record<'page' | 'source' | 'device' | 'search', Map<string, number>> = { page: new Map(), source: new Map(), device: new Map(), search: new Map() };
    let visitors = 0;
    let views = 0;
    for (const row of await host.collections.list(byMonth ? 'months' : 'days')) {
      const slot = chart.get(String(byMonth ? row.month : row.day));
      if (!slot) continue;
      const hits = Number(row.hits) || 0;
      const name = String(row.name ?? '');
      if (row.kind === 'visitors') {
        visitors += hits;
        slot.visitors += hits;
      } else if (row.kind === 'views') {
        views += hits;
        slot.views += hits;
      } else if (row.kind === 'page' || row.kind === 'source' || row.kind === 'device' || row.kind === 'search') {
        lists[row.kind].set(name, (lists[row.kind].get(name) ?? 0) + hits);
      }
    }
    const top = (list: Map<string, number>, label: (name: string) => string = (name) => name) =>
      [...list]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TOP)
        .map(([name, value]) => ({ label: label(name), value }));
    return {
      totals: [
        { label: 'Visitors', value: visitors },
        { label: 'Pages seen', value: views },
      ],
      // One bar says nothing a total does not.
      chart:
        range === 'today'
          ? null
          : {
              labels: slots,
              series: [
                { label: 'Visitors', values: slots.map((at) => chart.get(at)?.visitors ?? 0) },
                { label: 'Pages seen', values: slots.map((at) => chart.get(at)?.views ?? 0) },
              ],
            },
      lists: [
        { title: 'Pages read most', rows: top(lists.page) },
        { title: 'Where visitors came from', rows: top(lists.source, (name) => name || 'Directly (a typed address or a bookmark)') },
        { title: 'Devices', rows: top(lists.device, (name) => DEVICES[name] ?? name) },
        { title: 'Searched for on the site', rows: top(lists.search) },
      ],
    };
  },
};
