/**
 * A blog post (ADR 0007): a page's worth of blocks, with what makes it a post:
 * a date, a short summary, a cover picture and categories. Its body is made of
 * the same blocks as a page, so everything the editor can do on a page it can
 * do in a post.
 */
import { type Block, blocksText, cleanImage, type ImageValue, imageSources, normalizeBlocks } from './blocks.ts';
import { BLOG_SLUG, cleanTypeFields, type ContentType, postsType } from './types.ts';
import { type Issue, isObject, slugify, str } from './util.ts';

export interface Post {
  /** Served at `/blog/<slug>/`. Never empty. */
  slug: string;
  title: string;
  /** For search engines. Empty means "the excerpt". */
  description: string;
  /** The day it is dated, `YYYY-MM-DD`. Posts are listed newest first by this. */
  date: string;
  /** Shown in lists and in the feed. Empty means "taken from the post's words". */
  excerpt: string;
  cover: ImageValue | null;
  /** Names as the author wrote them; the address of a category comes from `slugify`. */
  categories: string[];
  /** What its type asks for besides: a client's name, a price, a second picture (ADR 0010). */
  fields: Record<string, unknown>;
  blocks: Block[];
}

export const POSTS_PER_PAGE = 10;
const MAX_CATEGORIES = 8;

/** A real calendar day written `YYYY-MM-DD`. */
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function cleanCategories(input: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(input) ? input : []) {
    const name = str(raw, 40).replace(/\s+/g, ' ').trim();
    const slug = slugify(name);
    // Two names that would share an address are one category: the first spelling is kept.
    if (!slug || seen.has(slug) || out.length >= MAX_CATEGORIES) continue;
    seen.add(slug);
    out.push(name);
  }
  return out;
}

/**
 * Untrusted input as a clean post. `today` dates a post that has no valid date
 * of its own; the caller supplies it, so the core never asks what day it is.
 */
export function normalizePost(input: unknown, today = '1970-01-01', type: ContentType = postsType()): { post: Post; issues: Issue[] } {
  const raw = isObject(input) ? input : {};
  const { blocks, issues } = normalizeBlocks(raw.blocks);
  const title = str(raw.title, 200).trim();
  if (!title) issues.push({ path: 'title', message: 'a post has a title' });
  const slug = slugify(raw.slug) || slugify(title);
  if (!slug) issues.push({ path: 'slug', message: 'a post has an address' });
  return {
    post: {
      slug,
      title,
      description: str(raw.description, 300).trim(),
      date: isDate(raw.date) ? raw.date : today,
      excerpt: str(raw.excerpt, 400).trim(),
      cover: cleanImage(raw.cover),
      categories: type.categories ? cleanCategories(raw.categories) : [],
      fields: cleanTypeFields(type, raw.fields, isDate),
      blocks,
    },
    issues,
  };
}

/** An entry's own address: `/projects/<slug>/`. */
export const entryPath = (type: ContentType, slug: string): string => `/${type.path}/${slug}/`;
/** A type's list of entries: `/projects/`, then `/projects/page/2/`. */
export const listPath = (type: ContentType, page = 1): string => (page <= 1 ? `/${type.path}/` : `/${type.path}/page/${page}/`);
export const typeCategoryPath = (type: ContentType, name: string, page = 1): string =>
  `/${type.path}/category/${slugify(name)}/${page <= 1 ? '' : `page/${page}/`}`;
export const feedPath = (type: ContentType): string => `/${type.path}/feed.xml`;

export const postPath = (slug: string): string => `/${BLOG_SLUG}/${slug}/`;
/** The blog's list of posts: `/blog/`, then `/blog/page/2/`. */
export const blogPath = (page = 1): string => (page <= 1 ? `/${BLOG_SLUG}/` : `/${BLOG_SLUG}/page/${page}/`);
export const categoryPath = (name: string, page = 1): string =>
  `/${BLOG_SLUG}/category/${slugify(name)}/${page <= 1 ? '' : `page/${page}/`}`;
export const FEED_PATH = `/${BLOG_SLUG}/feed.xml`;

/** What a list shows under a post's title. */
export const postExcerpt = (post: Post): string => post.excerpt || blocksText(post.blocks, 200);
export const postDescription = (post: Post): string => post.description || postExcerpt(post);

/** Newest first; posts of the same day in a fixed order. */
export const newestFirst = (posts: Post[]): Post[] =>
  [...posts].sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1));

/** Entries in the order their type lists them: by date, newest first, or by title. */
export const listed = (type: ContentType, entries: Post[]): Post[] =>
  type.dated ? newestFirst(entries) : [...entries].sort((a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug));

/** Every category these posts use, by name, with the posts in each. */
export function categoriesOf(posts: Post[]): { name: string; slug: string; posts: Post[] }[] {
  const found = new Map<string, { name: string; slug: string; posts: Post[] }>();
  for (const post of posts) {
    for (const name of post.categories) {
      const slug = slugify(name);
      const entry = found.get(slug) ?? { name, slug, posts: [] };
      entry.posts.push(post);
      found.set(slug, entry);
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A list cut into the pages of the blog. Always at least one page, so an empty blog still has an address. */
export function paginate<T>(items: T[], size = POSTS_PER_PAGE): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages.length ? pages : [[]];
}

/** The address of every image a post shows: its cover, then those in its blocks. */
export const postImageSources = (post: Post): string[] => [
  ...(post.cover ? [post.cover.src] : []),
  ...Object.values(post.fields).flatMap((v) => (isObject(v) && typeof v.src === 'string' && v.src ? [v.src] : [])),
  ...imageSources(post.blocks),
];
