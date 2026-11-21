/**
 * Statistics without a cookie (ADR 0053). The site's server counts a page as it
 * sends it: nothing is put on the page or in the visitor's browser. A visitor
 * is told apart from another by a fingerprint of their address and browser
 * under a key that changes every day and is then deleted; the database keeps
 * only each day's totals.
 *
 * All of it is here, apart, so that it can move into an extension once the
 * format can carry it (ADR 0053 d4): the runtime calls `seen` and `searched`,
 * the admin reads `statsShown`, and the table `visits` is read by nothing else.
 */
import { createHash } from 'node:crypto';
import { SESSION_COOKIE } from './accounts.ts';
import type { Shared } from './shared.ts';
import type { Store, VisitRow } from './store.ts';

export type Device = 'phone' | 'tablet' | 'computer';

/** How often what was counted is written to the database. */
export const FLUSH_MS = 5_000;
/** How long a visitor's fingerprint is looked for: the day, and a little more for a clock that is not quite right. */
const SEEN_MS = 26 * 3_600_000;
/** How long the time zone is kept before it is asked again: one the owner changed shows within this. */
const ZONE_MS = 60_000;
/** The longest address, source or search kept. */
const NAME_MAX = 200;
/** How many of each list the screen is shown. */
export const TOP = 10;

/** A browser calls itself one of these; a robot that does not is not counted. */
const BROWSER = /^(Mozilla|Opera)\//;
/** A browser's name that says it is a robot, a preview or a monitor. */
const ROBOT = /bot\b|bot\/|crawl|spider|slurp|preview|monitor|uptime|pingdom|lighthouse|headless|phantom|facebookexternalhit|embedly|quora link|whatsapp|telegram|discord|skype|bitly|google-|feedfetcher|python|curl|wget|java\//i;

/** Whether a request is a person reading a page (ADR 0053 d1): not a robot, not someone signed in, not a page loaded ahead. */
export function counted(request: Request): boolean {
  if (request.method !== 'GET') return false;
  const agent = request.headers.get('user-agent') ?? '';
  if (!BROWSER.test(agent) || ROBOT.test(agent)) return false;
  const ahead = `${request.headers.get('sec-purpose') ?? ''} ${request.headers.get('purpose') ?? ''} ${request.headers.get('x-purpose') ?? ''} ${request.headers.get('x-moz') ?? ''}`;
  if (/prefetch|preview|prerender/i.test(ahead)) return false;
  return !(request.headers.get('cookie') ?? '').split(';').some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
}

/** Phone, tablet or computer, from the browser's name. */
export function deviceOf(agent: string): Device {
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(agent)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(agent)) return 'phone';
  return 'computer';
}

/** The places visitors arrive from most, by the names people know them by. */
const KNOWN: [RegExp, string][] = [
  [/(^|\.)google\.[a-z.]+$/, 'Google'],
  [/(^|\.)bing\.com$/, 'Bing'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
  [/(^|\.)yahoo\.[a-z.]+$/, 'Yahoo'],
  [/(^|\.)yandex\.[a-z.]+$/, 'Yandex'],
  [/(^|\.)ecosia\.org$/, 'Ecosia'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)(twitter\.com|x\.com|t\.co)$/, 'X'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'LinkedIn'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)reddit\.com$/, 'Reddit'],
  [/(^|\.)pinterest\.[a-z.]+$/, 'Pinterest'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)chatgpt\.com$/, 'ChatGPT'],
];

/**
 * Where a visitor came from: a campaign's `utm_source`, a known place by its
 * name, another site by its address, or `''` when they came directly. `null`
 * when they came from another page of this site, which is no arrival.
 */
export function sourceOf(url: URL, referer: string | null): string | null {
  const campaign = (url.searchParams.get('utm_source') ?? '').trim().toLowerCase().slice(0, 60);
  if (campaign) return campaign;
  if (!referer) return '';
  let from: URL;
  try {
    from = new URL(referer);
  } catch {
    return '';
  }
  if (from.host === url.host) return null;
  const host = from.hostname.toLowerCase().replace(/^(www|m|l|lm)\./, '');
  return KNOWN.find(([pattern]) => pattern.test(host))?.[1] ?? host;
}

/** The day a moment is in, in a time zone, as YYYY-MM-DD. A zone that is not one is UTC. */
export function dayIn(zone: string, at: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/** Whether a time zone is one this program knows, such as `Europe/Bucharest`. */
export function isZone(zone: string): boolean {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(zone) && zone !== 'UTC') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export interface Visits {
  /** A page sent to a visitor, by its address. */
  seen(request: Request, ip: string, path: string): Promise<void>;
  /** Words searched for with the site's search. */
  searched(request: Request, query: string): Promise<void>;
  /** Writes what was counted to the database now. */
  flush(): Promise<void>;
  /** Stops writing by itself, after writing what is left. */
  stop(): Promise<void>;
}

/** What counts visits for one of the site's processes. Several processes on one database add to the same totals. */
export function visits(store: Store, shared: Shared, options: { now?: () => number; log?: (line: string) => void; flushMs?: number } = {}): Visits {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.error(line));
  const pending = new Map<string, number>();
  /** What is being counted now: written with the rest. */
  const counting = new Set<Promise<void>>();
  const track = (work: Promise<void>): Promise<void> => {
    counting.add(work);
    return work.finally(() => counting.delete(work));
  };
  let zone: { at: number; zone: Promise<string> } | null = null;
  let saltDay = '';

  const add = (day: string, kind: VisitRow['kind'], name = '', hits = 1): void => {
    const key = `${day}\0${kind}\0${name.slice(0, NAME_MAX)}`;
    pending.set(key, (pending.get(key) ?? 0) + hits);
  };
  const today = async (): Promise<string> => {
    if (!zone || now() - zone.at >= ZONE_MS) zone = { at: now(), zone: store.statsZone().catch(() => 'UTC') };
    return dayIn(await zone.zone, now());
  };
  /** The day's key, shared by the site's processes; yesterday's is deleted when today's is first needed here. */
  const saltOf = async (day: string): Promise<string> => {
    if (saltDay && saltDay !== day) await shared.del(`visits:key:${saltDay}`);
    saltDay = day;
    const kept = await shared.get(`visits:key:${day}`);
    if (kept) return kept;
    const made = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    await shared.set(`visits:key:${day}`, made, SEEN_MS);
    return (await shared.get(`visits:key:${day}`)) ?? made;
  };

  const flush = async (): Promise<void> => {
    await Promise.allSettled([...counting]);
    if (!pending.size) return;
    const rows: VisitRow[] = [...pending].map(([key, hits]) => {
      const [day, kind, name] = key.split('\0') as [string, VisitRow['kind'], string];
      return { day, kind, name, hits };
    });
    pending.clear();
    try {
      await store.addVisits(rows);
    } catch (error) {
      log(`The statistics could not be written: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const timer = setInterval(() => void flush(), options.flushMs ?? FLUSH_MS);
  (timer as { unref?: () => void }).unref?.();

  return {
    seen: (request, ip, path) => (counted(request) ? track(see(request, ip, path)) : Promise.resolve()),
    searched: (request, query) => track(search(request, query)),
    flush,
    async stop() {
      clearInterval(timer);
      await flush();
    },
  };

  async function see(request: Request, ip: string, path: string): Promise<void> {
    const day = await today();
    const agent = request.headers.get('user-agent') ?? '';
    const fingerprint = createHash('sha256').update(`${await saltOf(day)}\0${ip}\0${agent}`).digest('base64url');
    const first = (await shared.hit(`visits:seen:${day}:${fingerprint}`, SEEN_MS)) === 1;
    add(day, 'views');
    add(day, 'page', path);
    const source = sourceOf(new URL(request.url), request.headers.get('referer'));
    // An arrival from elsewhere is counted each time; coming directly, once a day.
    if (source || (source === '' && first)) add(day, 'source', source);
    if (first) {
      add(day, 'visitors');
      add(day, 'device', deviceOf(agent));
    }
  }

  async function search(request: Request, query: string): Promise<void> {
    const words = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!words || !counted(request)) return;
    add(await today(), 'search', words);
  }
}

export type Range = 'today' | '7' | '30' | '365';
export const RANGES: readonly Range[] = ['today', '7', '30', '365'];

/** What the Statistics screen is shown (ADR 0053 d3). */
export interface StatsShown {
  range: Range;
  zone: string;
  /** The totals of the whole range. */
  visitors: number;
  views: number;
  /** The chart: by day, or by month for 12 months, from the oldest; `at` is YYYY-MM-DD or YYYY-MM. */
  chart: { at: string; visitors: number; views: number }[];
  pages: { name: string; hits: number }[];
  /** `''` is directly. */
  sources: { name: string; hits: number }[];
  devices: { name: Device; hits: number }[];
  searches: { name: string; hits: number }[];
}

/** The days of a range, in a time zone, from the oldest, ending today. */
export function daysOf(range: Range, zone: string, at: number): string[] {
  const count = range === 'today' ? 1 : Number(range);
  const last = dayIn(zone, at);
  const end = Date.parse(`${last}T12:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** The totals of a range, summed and ordered for the screen. */
export function summarize(rows: readonly VisitRow[], range: Range, zone: string, days: readonly string[]): StatsShown {
  const byMonth = range === '365';
  const slots = byMonth ? [...new Set(days.map((d) => d.slice(0, 7)))] : [...days];
  const chart = new Map(slots.map((at) => [at, { at, visitors: 0, views: 0 }]));
  const lists = { page: new Map<string, number>(), source: new Map<string, number>(), device: new Map<string, number>(), search: new Map<string, number>() };
  let visitors = 0;
  let views = 0;
  for (const row of rows) {
    const slot = chart.get(byMonth ? row.day.slice(0, 7) : row.day);
    if (!slot) continue;
    if (row.kind === 'visitors') {
      visitors += row.hits;
      slot.visitors += row.hits;
    } else if (row.kind === 'views') {
      views += row.hits;
      slot.views += row.hits;
    } else {
      const list = lists[row.kind];
      list.set(row.name, (list.get(row.name) ?? 0) + row.hits);
    }
  }
  const top = (list: Map<string, number>) =>
    [...list]
      .map(([name, hits]) => ({ name, hits }))
      .sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name))
      .slice(0, TOP);
  return {
    range,
    zone,
    visitors,
    views,
    chart: [...chart.values()],
    pages: top(lists.page),
    sources: top(lists.source),
    devices: top(lists.device) as { name: Device; hits: number }[],
    searches: top(lists.search),
  };
}

/** What the admin is shown for a range. The owner's browser gives its time zone, which becomes the statistics' own. */
export async function statsShown(store: Store, range: Range, options: { zone?: string; owner?: boolean; now?: number } = {}): Promise<StatsShown> {
  let zone = await store.statsZone();
  if (options.owner && options.zone && isZone(options.zone) && options.zone !== zone) {
    await store.setStatsZone(options.zone);
    zone = options.zone;
  }
  const days = daysOf(range, zone, options.now ?? Date.now());
  return summarize(await store.visits(days[0] as string, days[days.length - 1] as string), range, zone, days);
}
