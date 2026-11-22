/**
 * IndexNow (ADR 0063 d2): when the owner asks for it, search engines that
 * read IndexNow (Bing, Yandex, Seznam, Naver…) are told at once of an address
 * just published, instead of finding it at their next visit. The site proves
 * it is the one telling them with a key it serves at `/<key>.txt`.
 */
import { pagePath } from '../core/page.ts';
import { entryPath } from '../core/post.ts';
import type { SiteEvent, Store } from './store.ts';

/** Where IndexNow is told; it passes the addresses on to every engine that reads it. */
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** How long after a publication the engines are told: what is published together is said together. */
export const INDEXNOW_DELAY_MS = 10_000;
/** The most addresses one message may hold. */
const MOST = 10_000;

/** A key as IndexNow asks for one: letters, digits and dashes, 8 to 128 of them. */
export const isIndexNowKey = (key: string): boolean => /^[a-zA-Z0-9-]{8,128}$/.test(key);

/** The addresses a sitemap lists, as written in it. */
export const sitemapUrls = (sitemap: string): Set<string> =>
  new Set([...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => (m[1] as string).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')));

export interface IndexNow {
  /** Tells the engines now of what waits to be said. */
  flush(): Promise<void>;
  stop(): void;
}

/**
 * Hears the site's publications and tells the engines of each address that a
 * visitor and a search engine may now read: only those in the sitemap, so a
 * page hidden from search engines or behind a password is never said.
 */
export function indexNow(
  store: Store,
  options: {
    /** The published site's files, to read its sitemap. */
    files: () => Promise<Map<string, string | Uint8Array>>;
    /** What must happen once happens once, when several processes hear the same publication. */
    claim?: (key: string, ms: number) => Promise<boolean>;
    fetch?: (url: string, init: RequestInit) => Promise<Response>;
    delayMs?: number;
    log?: (line: string) => void;
  },
): IndexNow {
  const send = options.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const log = options.log ?? console.log;
  const waiting: SiteEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    const events = waiting.splice(0);
    const site = await store.site();
    if (!events.length || !site.indexNow || !site.url) return;
    const listed = sitemapUrls(String((await options.files()).get('sitemap.xml') ?? ''));
    const urls = new Set<string>();
    for (const { name, data } of events) {
      const slug = String(data.slug ?? '');
      const type = name === 'entry.published' ? site.types.find((t) => t.id === data.type) : undefined;
      const path = name === 'page.published' ? pagePath(slug) : type ? entryPath(type, slug) : '';
      if (path && listed.has(`${site.url}${path}`)) urls.add(`${site.url}${path}`);
    }
    const urlList: string[] = [];
    for (const url of urls) if (!options.claim || (await options.claim(`indexnow:${url}`, 60_000))) urlList.push(url);
    if (!urlList.length) return;
    const key = await store.indexNowKey();
    const response = await send(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: new URL(site.url).host, key, keyLocation: `${site.url}/${key}.txt`, urlList: urlList.slice(0, MOST) }),
      signal: AbortSignal.timeout(15_000),
    });
    // 200 and 202 are both "received"; anything else is the engines' to explain.
    if (!response.ok) log(`IndexNow did not take the addresses just published: ${response.status} ${response.statusText}`.trim());
  };

  const off = store.onEvent((event) => {
    if (event.name !== 'page.published' && event.name !== 'entry.published') return;
    waiting.push(event);
    if (timer) return;
    timer = setTimeout(() => void flush().catch((error: unknown) => log(`IndexNow could not be told: ${error instanceof Error ? error.message : String(error)}`)), options.delayMs ?? INDEXNOW_DELAY_MS);
    (timer as { unref?: () => void }).unref?.();
  });

  return {
    flush,
    stop: () => {
      off();
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
