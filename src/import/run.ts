/**
 * Carries out an import plan (ADR 0009): fetches the images, writes the pages
 * and posts, and says what happened.
 *
 * Nothing already in the site is replaced. A page or post whose address is
 * taken is left as it is and named in the report, so running an import twice,
 * or into a site someone has started, loses no work.
 */
import { MEDIA_MAX_BYTES, type MenuNode, reservedSlugs } from '../core/index.ts';
import type { Store } from '../site/store.ts';
import type { ImportPlan } from './wxr.ts';

/** Gets the bytes at an address. Throws, with a reason a person can read, when it cannot. */
export type FetchImage = (url: string) => Promise<Uint8Array>;

export interface ImportReport {
  pages: number;
  posts: number;
  /** Entries of the content types the import added. */
  entries: number;
  /** Of those, how many were left unpublished. */
  drafts: number;
  images: number;
  redirects: number;
  menu: boolean;
  notes: string[];
}

const TIMEOUT_MS = 30_000;
/** An export file larger than this is refused by the editor. WordPress splits its exports long before. */
export const IMPORT_MAX_BYTES = 64 * 1024 * 1024;

/** Fetches over the network, refusing what could not be an image before reading it all. */
export const fetchImage: FetchImage = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (!response.ok) throw new Error(`the old site answered ${response.status}`);
  // Said up front, it is refused before the download; a server that does not say is caught after.
  if (Number(response.headers.get('content-length') ?? 0) > MEDIA_MAX_BYTES) throw new Error('larger than 10 MB');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MEDIA_MAX_BYTES) throw new Error('larger than 10 MB');
  return bytes;
};

async function inTurns<T>(items: T[], workers: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (next < items.length) await work(items[next++] as T);
    }),
  );
}

/** Every `src` in a document, passed through `to`. Images are the only things that carry one. */
function repoint<T>(value: T, to: (src: string) => string): T {
  if (Array.isArray(value)) return value.map((v) => repoint(v, to)) as T;
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) out[key] = key === 'src' && typeof inner === 'string' ? to(inner) : repoint(inner, to);
  return out as T;
}

export interface ImportOptions {
  /** How images are fetched; null leaves every image pointing at the old site. */
  fetchImage: FetchImage | null;
  /** The site was just created: take its name, language, address and menu from the old one. */
  fresh: boolean;
  /** Called as each image is done, for a sign of life on a long import. */
  onImage?: (done: number, total: number) => void;
}

export async function runImport(store: Store, plan: ImportPlan, options: ImportOptions): Promise<ImportReport> {
  const notes = [...plan.notes];

  // Images first: a page is written once, already pointing at this site's copy.
  const stored = new Map<string, string>();
  const failed: string[] = [];
  if (options.fetchImage) {
    const fetchOne = options.fetchImage;
    let done = 0;
    await inTurns(plan.images, 4, async (url) => {
      try {
        const label = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
        stored.set(url, (await store.addMedia(await fetchOne(url), label)).path);
      } catch (error) {
        failed.push(`${url} (${error instanceof Error ? error.message : String(error)})`);
      }
      options.onImage?.(++done, plan.images.length);
    });
    if (failed.length) {
      notes.push(`${failed.length} images could not be copied and still point at the old site:\n${failed.slice(0, 20).map((f) => `    ${f}`).join('\n')}${failed.length > 20 ? `\n    and ${failed.length - 20} more` : ''}`);
    }
  } else if (plan.images.length) {
    notes.push(`${plan.images.length} images were not copied (you asked for that) and still point at the old site. They will break when the old site is gone.`);
  }
  const src = (address: string): string => stored.get(address) ?? address;

  const kept: string[] = [];
  let pages = 0;
  let posts = 0;
  let drafts = 0;

  // Content types the owner asked for, added beside whatever the site already has. They come
  // first, so a type the site refuses (a page already lives at its address) is known before its entries.
  const added: typeof plan.types = [];
  for (const type of plan.types) {
    const site = await store.site();
    if (!site.types.some((t) => t.id === type.id)) {
      try {
        await store.setSite({ ...site, types: [...site.types, type] });
      } catch (error) {
        notes.push(`The content type "${type.name}" was not added, and its entries were not imported: ${error instanceof Error ? error.message : String(error)}.`);
        continue;
      }
    }
    added.push(type);
  }

  const reserved = new Set(reservedSlugs(await store.site()));
  for (const { publish, ...page } of plan.pages) {
    if ((await store.draft(page.slug)) || reserved.has(page.slug)) {
      kept.push(`the page "${page.title}"`);
      continue;
    }
    const saved = await store.savePage(repoint(page, src));
    if (publish) await store.publish(saved.slug);
    else drafts++;
    pages++;
  }
  for (const { publish, ...post } of plan.posts) {
    if (await store.postDraft(post.slug)) {
      kept.push(`the post "${post.title}"`);
      continue;
    }
    const saved = await store.savePost(repoint(post, src));
    if (publish) await store.publishPost(saved.slug);
    else drafts++;
    posts++;
  }
  let entries = 0;
  for (const type of added) {
    for (const { publish, ...entry } of plan.entries[type.id] ?? []) {
      if (await store.entryDraft(type.id, entry.slug)) {
        kept.push(`"${entry.title}" (${type.name})`);
        continue;
      }
      const saved = await store.saveEntry(type.id, repoint(entry, src));
      if (publish) await store.publishEntry(type.id, saved.slug);
      else drafts++;
      entries++;
    }
  }
  if (kept.length) notes.push(`Already in this site under the same address, and left as they were: ${kept.slice(0, 10).join(', ')}${kept.length > 10 ? ` and ${kept.length - 10} more` : ''}.`);

  let menu: MenuNode[] | null = null;
  if (options.fresh) {
    menu = plan.menu;
    await store.setSite({ ...(await store.site()), ...plan.site, menu });
  } else if (plan.menu) {
    notes.push('The site already had its settings, so its name, address and menu were left alone.');
  }
  const before = await store.redirects();
  const redirects = (await store.setRedirects([...before, ...plan.redirects])).length - before.length;

  return { pages, posts, entries, drafts, images: stored.size, redirects, menu: menu !== null, notes };
}
