/**
 * Every page and entry with what it says to search engines, in one table
 * (ADR 0077 d2): its title for search engines and its description, written
 * here without opening each one.
 */
import { cleanSeo, contentTypes, entryPath, normalizePage, normalizePost, pageDescription, pagePath, postDescription, str } from '../core/index.ts';
import type { Store } from './store.ts';

export interface SeoRow {
  /** The content type's id; empty for a page. */
  type: string;
  slug: string;
  title: string;
  /** Where it is on the site. */
  path: string;
  seoTitle: string;
  description: string;
  /** The description the site writes when it has none (ADR 0058 d1). */
  auto: string;
  noindex: boolean;
  published: boolean;
}

/** The pages in the site's language, then each type's entries, as their lists show them. */
export async function seoRows(store: Store): Promise<SeoRow[]> {
  const site = await store.site();
  const rows: SeoRow[] = [];
  for (const listed of await store.pages()) {
    if (listed.language !== site.language) continue;
    const page = await store.draft(listed.slug);
    if (!page) continue;
    rows.push({
      type: '',
      slug: page.slug,
      title: page.title,
      path: pagePath(page.slug),
      seoTitle: page.seoTitle ?? '',
      description: page.description,
      auto: pageDescription({ ...page, description: '' }),
      noindex: !!page.noindex,
      published: listed.published,
    });
  }
  for (const type of contentTypes(site)) {
    const published = new Map((await store.entries(type.id)).map((e) => [e.slug, e.published]));
    for (const post of await store.draftEntries(type.id)) {
      rows.push({
        type: type.id,
        slug: post.slug,
        title: post.title,
        path: entryPath(type, post.slug),
        seoTitle: post.seoTitle ?? '',
        description: post.description,
        auto: postDescription({ ...post, description: '' }),
        noindex: !!post.noindex,
        published: published.get(post.slug) ?? false,
      });
    }
  }
  return rows;
}

/**
 * Writes one page's or entry's title for search engines and description. What
 * was published as it was written is published again with them, so the site
 * says them at once; a draft with other changes keeps waiting for its author.
 */
export async function setSeo(store: Store, input: Record<string, unknown>): Promise<SeoRow> {
  const type = str(input.type, 80);
  const slug = str(input.slug, 300);
  const seo = cleanSeo({ seoTitle: input.seoTitle });
  const description = str(input.description, 300).trim();
  if (!type) {
    const listed = (await store.pages()).find((p) => p.slug === slug);
    const page = await store.draft(slug);
    if (!listed || !page) throw new Error('there is no page at that address');
    const { page: next } = normalizePage({ ...page, seoTitle: seo.seoTitle ?? '', description });
    await store.savePage(next);
    if (listed.published && !listed.changed) await store.publish(slug);
  } else {
    const listed = (await store.entries(type)).find((e) => e.slug === slug);
    const post = await store.entryDraft(type, slug);
    if (!listed || !post) throw new Error('there is no entry at that address');
    const { post: next } = normalizePost({ ...post, seoTitle: seo.seoTitle ?? '', description }, undefined, await store.type(type));
    await store.saveEntry(type, next);
    if (listed.published && !listed.changed) await store.publishEntry(type, slug);
  }
  return (await seoRows(store)).find((row) => row.type === type && row.slug === slug) as SeoRow;
}
