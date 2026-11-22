/**
 * What tells a visit (ADR 0053, ADR 0062 d8). The site's server reads a page
 * as it sends it: nothing is put on the page or in the visitor's browser. A
 * visitor is told apart from another by a fingerprint of their address and
 * browser under a key that changes every day and is then deleted.
 *
 * The totals are the statistics extension's (`extensions/stats`): what is read
 * here is told to the extensions that listen, never who made the visit. While
 * none listens, nothing is read.
 */
import { createHash } from 'node:crypto';
import { SESSION_COOKIE } from './accounts.ts';
import type { Batches } from './extensions.ts';
import type { Shared } from './shared.ts';
import type { Store } from './store.ts';

export type Device = 'phone' | 'tablet' | 'computer';

/** How long a visitor's fingerprint is looked for: the day, and a little more for a clock that is not quite right. */
const SEEN_MS = 26 * 3_600_000;
/** How long the time zone is kept before it is asked again: one the owner changed shows within this. */
const ZONE_MS = 60_000;
/** The longest address, source or search told. */
const NAME_MAX = 200;

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
  /** Waits for what is being read now; what was read is told with the extensions' next batch. */
  flush(): Promise<void>;
}

/** What reads the visits for one of the site's processes and tells the extensions that listen (ADR 0062 d2). */
export function visits(store: Store, shared: Shared, options: { now?: () => number; told?: Batches } = {}): Visits {
  const told = options.told;
  const now = options.now ?? Date.now;
  /** What is being read now. */
  const reading = new Set<Promise<void>>();
  const track = (work: Promise<void>): Promise<void> => {
    reading.add(work);
    return work.finally(() => reading.delete(work));
  };
  let zone: { at: number; zone: Promise<string> } | null = null;
  let saltDay = '';

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

  return {
    seen: (request, ip, path) => (counted(request) ? track(see(request, ip, path)) : Promise.resolve()),
    searched: (request, query) => track(search(request, query)),
    async flush() {
      await Promise.allSettled([...reading]);
    },
  };

  async function see(request: Request, ip: string, path: string): Promise<void> {
    if (!told || !(await told.listens('page.served'))) return;
    const day = await today();
    const agent = request.headers.get('user-agent') ?? '';
    const fingerprint = createHash('sha256').update(`${await saltOf(day)}\0${ip}\0${agent}`).digest('base64url');
    const first = (await shared.hit(`visits:seen:${day}:${fingerprint}`, SEEN_MS)) === 1;
    const source = sourceOf(new URL(request.url), request.headers.get('referer'));
    // What was read of the visit, never who made it.
    told.add('page.served', { day, path: path.slice(0, NAME_MAX), source: source?.slice(0, NAME_MAX) ?? null, device: deviceOf(agent), first });
  }

  async function search(request: Request, query: string): Promise<void> {
    const words = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!words || !counted(request) || !told || !(await told.listens('search.made'))) return;
    told.add('search.made', { day: await today(), words: words.slice(0, NAME_MAX) });
  }
}

/** The owner's browser gives its time zone, which becomes the statistics' own (ADR 0053 d3): the days the program tells begin in it. */
export async function zoneFor(store: Store, given: string, owner: boolean): Promise<string> {
  const zone = await store.statsZone();
  if (!owner || !given || !isZone(given) || given === zone) return zone;
  await store.setStatsZone(given);
  return given;
}
