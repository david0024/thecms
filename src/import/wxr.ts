/**
 * A WordPress export file (WXR) read into a plan (ADR 0009): the pages, posts,
 * menu and settings this site would get, the images to fetch, the old
 * addresses to keep alive, and a plain list of what could not come over.
 *
 * Making the plan touches nothing: no database, no network. `run.ts` carries
 * it out.
 */
import {
  BLOG_SLUG,
  type Block,
  blogPath,
  categoryPath,
  type ContentType,
  entryPath,
  normalizeTypes,
  isDate,
  MENU_DEPTH,
  MENU_MAX_ITEMS,
  type MenuNode,
  type MenuTarget,
  newId,
  pagePath,
  postPath,
  RESERVED_SLUGS,
  slugify,
} from '../core/index.ts';
import { type ContentContext, htmlToBlocks } from './content.ts';
import { decodeHtml, parseHtml, plainText } from './html.ts';
import { child, childrenOf, parseXml, textOf, type XmlElement } from './xml.ts';

export interface PlannedPage {
  slug: string;
  title: string;
  description: string;
  inMenu: boolean;
  blocks: Block[];
  publish: boolean;
}
export interface PlannedPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  excerpt: string;
  cover: { src: string; alt: string } | null;
  categories: string[];
  blocks: Block[];
  publish: boolean;
}
export interface ImportPlan {
  site: { name: string; language: string; url: string };
  pages: PlannedPage[];
  posts: PlannedPost[];
  /** Content types to add to the site, for the kinds of entry the owner asked to bring (ADR 0009 d10). */
  types: ContentType[];
  /** The entries of those types, by the type's name. */
  entries: Record<string, PlannedPost[]>;
  /** null: no menu was found, and the site makes one from its pages. */
  menu: MenuNode[] | null;
  /** Images the content shows that lived on the old site, by full address. */
  images: string[];
  /** Old addresses that changed, and where each one leads now. */
  redirects: { from: string; to: string }[];
  /** What the owner should know, in sentences. */
  notes: string[];
}

interface Item {
  id: string;
  type: string;
  status: string;
  title: string;
  link: string;
  name: string;
  parent: string;
  order: number;
  date: string;
  content: string;
  excerpt: string;
  password: string;
  meta: Map<string, string>;
  categories: { domain: string; nicename: string; name: string }[];
  comments: number;
}

/** Kinds of entry WordPress keeps for itself; leaving them out loses nothing an owner wrote. */
const HOUSEKEEPING = new Set([
  'revision', 'custom_css', 'customize_changeset', 'oembed_cache', 'user_request', 'wp_global_styles', 'wp_template',
  'wp_template_part', 'wp_font_family', 'wp_font_face', 'attachment', 'nav_menu_item', 'wp_navigation', 'page', 'post',
]);
const SEO_DESCRIPTIONS = ['_yoast_wpseo_metadesc', 'rank_math_description', '_aioseo_description', '_aioseop_description', '_seopress_titles_desc'];

function readItem(el: XmlElement): Item {
  const meta = new Map<string, string>();
  for (const m of childrenOf(el, 'wp:postmeta')) meta.set(textOf(m, 'wp:meta_key'), child(m, 'wp:meta_value')?.text ?? '');
  return {
    id: textOf(el, 'wp:post_id'),
    type: textOf(el, 'wp:post_type'),
    status: textOf(el, 'wp:status'),
    title: decodeHtml(textOf(el, 'title')),
    link: textOf(el, 'link'),
    name: textOf(el, 'wp:post_name'),
    parent: textOf(el, 'wp:post_parent') || '0',
    order: Number(textOf(el, 'wp:menu_order')) || 0,
    date: textOf(el, 'wp:post_date').slice(0, 10),
    content: child(el, 'content:encoded')?.text ?? '',
    excerpt: child(el, 'excerpt:encoded')?.text ?? '',
    password: textOf(el, 'wp:post_password'),
    meta,
    categories: childrenOf(el, 'category').map((c) => ({ domain: c.attrs.domain ?? '', nicename: c.attrs.nicename ?? '', name: decodeHtml(c.text.trim()) })),
    comments: childrenOf(el, 'wp:comment').length,
  };
}

const parse = (href: string, base: string): URL | null => {
  try {
    return new URL(href, `${base}/`);
  } catch {
    return null;
  }
};
const host = (url: URL): string => url.host.toLowerCase().replace(/^www\./, '');
/** One spelling for an address: no scheme, no `www.`, no trailing slash. `?p=12` is kept, being an address of its own. */
function keyOf(url: URL): string {
  const id = /[?&](?:p|page_id)=(\d+)/.exec(url.search)?.[1];
  return `${host(url)}${url.pathname.replace(/\/+$/, '')}${id ? `?${id}` : ''}`;
}

const list = (titles: Set<string>): string => {
  const all = [...titles];
  const shown = all.slice(0, 5).map((t) => `"${t}"`).join(', ');
  return all.length > 5 ? `${shown} and ${all.length - 5} more` : shown;
};

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function unique(wanted: string, taken: Set<string>): string {
  let slug = wanted;
  for (let n = 2; taken.has(slug); n++) slug = `${wanted.slice(0, 76)}-${n}`;
  taken.add(slug);
  return slug;
}

/** Reads the file and decides what this site would get from it. Throws when it is not a WordPress export. */
export function planImport(xml: string, today: string, options: { /** WordPress post types to bring as content types (`portfolio`). */ types?: string[] } = {}): ImportPlan {
  const rss = parseXml(xml);
  const channel = child(rss, 'channel');
  if (rss.name !== 'rss' || !channel || !child(channel, 'wp:wxr_version')) {
    throw new Error('this is not a WordPress export file (in WordPress: Tools, Export, All content)');
  }
  const notes: string[] = [];
  const base = (textOf(channel, 'wp:base_blog_url') || textOf(channel, 'wp:base_site_url') || textOf(channel, 'link')).replace(/\/+$/, '');
  const baseUrl = parse(base, base);
  const siteHost = baseUrl ? host(baseUrl) : '';
  const baseKey = baseUrl ? keyOf(baseUrl) : '';
  const items = childrenOf(channel, 'item').map(readItem);
  const byId = new Map(items.map((item) => [item.id, item]));

  // Attachments: the files the old site held.
  const attachments = new Map<string, { src: string; alt: string }>();
  const attachmentKeys = new Map<string, string>();
  for (const el of childrenOf(channel, 'item')) {
    if (textOf(el, 'wp:post_type') !== 'attachment') continue;
    const url = parse(textOf(el, 'wp:attachment_url'), base);
    if (!url || !/^https?:$/.test(url.protocol)) continue;
    const item = byId.get(textOf(el, 'wp:post_id')) as Item;
    attachments.set(item.id, { src: url.href, alt: (item.meta.get('_wp_attachment_image_alt') ?? '').trim() });
    attachmentKeys.set(keyOf(url), url.href);
  }

  // Which entries become pages and posts, and under which address.
  const live = (item: Item): boolean => !['trash', 'auto-draft', 'inherit'].includes(item.status);
  const pageItems = items.filter((i) => i.type === 'page' && live(i)).sort((a, b) => a.order - b.order);
  const postItems = items.filter((i) => i.type === 'post' && live(i));
  const published = (item: Item): boolean => item.status === 'publish' && !item.password;
  // Kinds of entry a plugin or theme added. Which of them are content and which are a plugin's
  // own records cannot be told from the file, so only the ones the owner names are brought.
  const title = (slug: string): string => slug.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const types = normalizeTypes(
    [...new Set(options.types ?? [])]
      .filter((name) => !['page', 'post', 'attachment', 'nav_menu_item'].includes(name) && items.some((i) => i.type === name && live(i)))
      .map((name) => ({ id: name, name: title(name), singular: title(name), path: name })),
  );
  const typeOf = new Map<string, ContentType>();
  for (const name of options.types ?? []) {
    const type = types.find((t) => t.id === slugify(name));
    if (type) typeOf.set(name, type);
  }

  const paths = new Map<string, string>();
  const pathById = new Map<string, string>();
  const pageSlugs = new Map<Item, string>();
  const postSlugs = new Map<Item, string>();
  const takenPages = new Set<string>([...RESERVED_SLUGS, ...types.map((t) => t.path)]);
  const takenPosts = new Set<string>();
  const remember = (item: Item, path: string): void => {
    pathById.set(item.id, path);
    const url = parse(item.link, base);
    if (url) paths.set(keyOf(url), path);
    if (baseUrl) paths.set(`${baseKey}?${item.id}`, path);
  };
  let postsPage: Item | null = null;
  let home: Item | null = null;
  for (const item of pageItems) {
    const url = parse(item.link, base);
    if (!home && url && baseUrl && keyOf(url) === baseKey && published(item)) {
      home = item;
      pageSlugs.set(item, '');
      remember(item, '/');
      continue;
    }
    const wanted = slugify(item.name) || slugify(item.title) || `page-${item.id}`;
    // WordPress lists the posts on an empty page; here the blog has an address of its own.
    if (wanted === BLOG_SLUG && !item.content.trim()) {
      postsPage = item;
      remember(item, blogPath());
      continue;
    }
    const slug = unique(RESERVED_SLUGS.includes(wanted) ? `${wanted}-page` : wanted, takenPages);
    pageSlugs.set(item, slug);
    remember(item, pagePath(slug));
  }
  for (const item of postItems) {
    const slug = unique(slugify(item.name) || slugify(item.title) || `post-${item.id}`, takenPosts);
    postSlugs.set(item, slug);
    remember(item, postPath(slug));
  }

  const entrySlugs = new Map<Item, string>();
  const takenEntries = new Map<string, Set<string>>();
  for (const item of items) {
    const type = typeOf.get(item.type);
    if (!type || !live(item)) continue;
    if (!takenEntries.has(type.id)) takenEntries.set(type.id, new Set());
    const slug = unique(slugify(item.name) || slugify(item.title) || `entry-${item.id}`, takenEntries.get(type.id) as Set<string>);
    entrySlugs.set(item, slug);
    remember(item, entryPath(type, slug));
  }

  // Content, with its links and images pointed at this site.
  const images = new Set<string>();
  const lost = new Map<string, { titles: Set<string>; which: Set<string> }>();
  const elsewhere = new Set<string>();
  const strays = new Set<string>();
  const files = new Set<string>();
  const contextFor = (title: string): ContentContext => ({
    lost(what, which) {
      if (!lost.has(what)) lost.set(what, { titles: new Set(), which: new Set() });
      lost.get(what)?.titles.add(title);
      if (which) lost.get(what)?.which.add(which);
    },
    attachment: (id) => attachments.get(id) ?? null,
    link(href) {
      if (/^(#|mailto:|tel:)/i.test(href)) return href;
      const url = parse(href, base);
      if (!url || !/^https?:$/.test(url.protocol)) return href;
      if (host(url) !== siteHost) return url.href;
      const key = keyOf(url);
      const path = paths.get(key) ?? (key === baseKey ? '/' : undefined);
      if (path !== undefined) return `${path}${url.hash}`;
      if (attachmentKeys.has(key) || /\/wp-content\/uploads\//.test(url.pathname)) files.add(title);
      else strays.add(title);
      return url.href;
    },
    image(src) {
      const url = parse(src, base);
      if (!url || !/^https?:$/.test(url.protocol)) return '';
      // WordPress shows a resized copy (`photo-300x200.jpg`); the picture it was made from is the one to keep.
      const original = attachmentKeys.get(keyOf(new URL(url.href.replace(/-\d+x\d+(\.[a-zA-Z0-9]+)$/, '$1'))));
      const known = original ?? attachmentKeys.get(keyOf(url));
      if (!known && host(url) !== siteHost) {
        elsewhere.add(title);
        return url.href;
      }
      const address = known ?? url.href;
      images.add(address);
      return address;
    },
  });

  const description = (item: Item): string => {
    for (const key of SEO_DESCRIPTIONS) {
      const value = (item.meta.get(key) ?? '').trim();
      // A description written as a formula ("%%excerpt%%") is the old plugin's, not words.
      if (value && !value.includes('%')) return decodeHtml(value).slice(0, 300);
    }
    return '';
  };
  const held = new Set<string>();
  const publishOf = (item: Item): boolean => {
    if (!published(item) && (item.status === 'private' || item.password)) held.add(item.title || 'Untitled');
    return published(item);
  };

  const name = decodeHtml(textOf(channel, 'title')) || 'My site';
  const tagline = decodeHtml(textOf(channel, 'description'));
  const hasMenuItems = items.some((i) => i.type === 'nav_menu_item' || i.type === 'wp_navigation');
  const pages: PlannedPage[] = [];
  for (const [item, slug] of pageSlugs) {
    const title = item.title || 'Untitled';
    pages.push({
      slug,
      title,
      description: description(item),
      inMenu: hasMenuItems ? true : item.parent === '0',
      // WordPress has the theme print a page's title; here a page says its own, at the top.
      blocks: [{ id: newId(), type: 'hero', content: slug ? { title } : { title: name, subtitle: tagline } }, ...htmlToBlocks(item.content, contextFor(title))],
      publish: publishOf(item),
    });
  }
  const tags = new Set<string>();
  const asEntry = (item: Item, slug: string, categories: boolean): PlannedPost => {
    const heading = item.title || 'Untitled';
    const thumb = attachments.get(item.meta.get('_thumbnail_id') ?? '');
    const ctx = contextFor(heading);
    return {
      slug,
      title: heading,
      description: description(item),
      date: isDate(item.date) ? item.date : today,
      excerpt: plainText(parseHtml(item.excerpt)).slice(0, 400),
      cover: thumb ? { src: ctx.image(thumb.src), alt: thumb.alt } : null,
      categories: categories ? item.categories.filter((c) => c.domain === 'category' && c.nicename !== 'uncategorized').map((c) => c.name) : [],
      blocks: htmlToBlocks(item.content, ctx),
      publish: publishOf(item),
    };
  };
  const posts: PlannedPost[] = [];
  for (const [item, slug] of postSlugs) {
    for (const c of item.categories) if (c.domain === 'post_tag') tags.add(c.nicename);
    posts.push(asEntry(item, slug, true));
  }
  const entries: Record<string, PlannedPost[]> = {};
  for (const [item, slug] of entrySlugs) {
    const type = typeOf.get(item.type) as ContentType;
    (entries[type.id] ??= []).push(asEntry(item, slug, false));
  }

  const anyPostPublished = posts.some((p) => p.publish);
  if (!home) {
    pages.unshift({
      slug: '',
      title: name,
      description: '',
      inMenu: true,
      blocks: [
        { id: newId(), type: 'hero', content: { title: name, subtitle: tagline } },
        // What the old front page showed: the latest posts.
        ...(anyPostPublished ? [{ id: newId(), type: 'entries' as const, content: { title: 'Latest posts', source: 'posts', count: 6, more: 'See all' } }] : []),
      ],
      publish: true,
    });
    notes.push('The old site had no page set as its front page (it showed the latest posts there), so a home page was made that lists the latest posts. Open it in the editor and make it yours.');
  }

  // The menu.
  const terms = new Map(childrenOf(channel, 'wp:category').map((c) => [textOf(c, 'wp:term_id'), decodeHtml(textOf(c, 'wp:cat_name'))]));
  const targetOfId = (kind: string, id: string): MenuTarget | null => {
    if (kind === 'category') return terms.has(id) ? { kind: 'url', href: categoryPath(terms.get(id) as string) } : null;
    const item = byId.get(id);
    if (!item) return null;
    if (item === postsPage) return { kind: 'blog' };
    if (pageSlugs.has(item)) return { kind: 'page', slug: pageSlugs.get(item) as string };
    if (postSlugs.has(item)) return { kind: 'url', href: postPath(postSlugs.get(item) as string) };
    return null;
  };
  const menuContext = contextFor('the menu');
  const targetOfUrl = (href: string): MenuTarget => {
    if (!href || href === '#') return { kind: 'none' };
    const to = menuContext.link(href);
    if (to === blogPath()) return { kind: 'blog' };
    const page = pages.find((p) => pagePath(p.slug) === to);
    return page ? { kind: 'page', slug: page.slug } : { kind: 'url', href: to };
  };
  interface Entry {
    id: string;
    parent: string;
    label: string;
    target: MenuTarget | null;
  }
  const build = (entries: Entry[]): MenuNode[] => {
    const under = (parent: string): MenuNode[] =>
      entries
        .filter((e) => e.parent === parent)
        .flatMap((e): MenuNode[] => {
          const children = under(e.id);
          // An item whose page did not come over still heads what is under it; alone, it is left out.
          const target = e.target ?? (children.length ? { kind: 'none' as const } : null);
          return target ? [{ id: newId(), label: e.label.slice(0, 60), target, children }] : [];
        });
    return under('0');
  };

  let menu: MenuNode[] | null = null;
  const menus = new Map<string, Item[]>();
  for (const item of items.filter((i) => i.type === 'nav_menu_item' && i.status === 'publish')) {
    const which = item.categories.find((c) => c.domain === 'nav_menu')?.nicename ?? '';
    menus.set(which, [...(menus.get(which) ?? []), item]);
  }
  if (menus.size) {
    const [chosen, entries] = [...menus].sort((a, b) => b[1].length - a[1].length)[0] as [string, Item[]];
    menu = build(
      entries
        .sort((a, b) => a.order - b.order)
        .map((item) => {
          const type = item.meta.get('_menu_item_type');
          const object = item.meta.get('_menu_item_object') ?? '';
          const target =
            type === 'custom'
              ? targetOfUrl((item.meta.get('_menu_item_url') ?? '').trim())
              : type === 'post_type' || type === 'taxonomy'
                ? targetOfId(object, item.meta.get('_menu_item_object_id') ?? '')
                : null;
          return { id: item.id, parent: item.meta.get('_menu_item_menu_item_parent') || '0', label: item.title, target };
        }),
    );
    if (menus.size > 1) notes.push(`The old site had ${menus.size} menus. The largest one ("${chosen}") is now the site's menu; the others were not brought over.`);
  } else {
    // A block theme keeps its menu as blocks: `<!-- wp:navigation-link {"label":"About",…} /-->`.
    const navigation = items
      .filter((i) => i.type === 'wp_navigation' && i.status === 'publish')
      .map((i) => [...i.content.matchAll(/<!--\s+(\/?)wp:navigation-(link|submenu)(?:\s+(\{.*?\}))?\s+(\/?)-->/g)])
      .sort((a, b) => b.length - a.length)[0];
    if (navigation?.length) {
      const entries: Entry[] = [];
      const open = ['0'];
      navigation.forEach((m, n) => {
        if (m[1]) return void (open.length > 1 && open.pop());
        let attrs: Record<string, unknown> = {};
        try {
          attrs = JSON.parse(m[3] ?? '{}') as Record<string, unknown>;
        } catch {
          return;
        }
        const id = `n${n}`;
        const kind = String(attrs.type ?? '');
        const byNumber = attrs.id !== undefined && attrs.kind !== 'custom' ? targetOfId(kind, String(attrs.id)) : null;
        entries.push({
          id,
          parent: open[open.length - 1] as string,
          label: plainText(parseHtml(String(attrs.label ?? ''))),
          target: byNumber ?? (typeof attrs.url === 'string' ? targetOfUrl(attrs.url) : null),
        });
        if (m[2] === 'submenu' && !m[4]) open.push(id);
      });
      menu = build(entries);
    }
  }
  if (menu && !menu.length) menu = null;
  if (menu) {
    const tooDeep = (nodes: MenuNode[], depth: number): boolean => nodes.length > MENU_MAX_ITEMS || nodes.some((n) => (depth >= MENU_DEPTH ? n.children.length > 0 : tooDeep(n.children, depth + 1)));
    if (tooDeep(menu, 1)) notes.push(`The old menu was larger than a menu here can be (${MENU_MAX_ITEMS} items at each level, ${MENU_DEPTH} levels). What did not fit was left out; check the menu in Site settings.`);
  }

  // Old addresses that moved.
  const redirects: { from: string; to: string }[] = [];
  const moved = (item: Item): void => {
    const url = parse(item.link, base);
    const to = pathById.get(item.id);
    if (!url || !to || url.search || host(url) !== siteHost) return;
    const from = url.pathname.endsWith('/') || /\.html?$/.test(url.pathname) ? url.pathname : `${url.pathname}/`;
    if (from !== to) redirects.push({ from, to });
  };
  for (const item of [...pageSlugs.keys(), ...postSlugs.keys(), ...entrySlugs.keys()]) if (published(item)) moved(item);
  if (postsPage) moved(postsPage);
  const usedCategories = new Set(posts.flatMap((p) => (p.publish ? p.categories : [])));
  for (const c of childrenOf(channel, 'wp:category')) {
    const title = decodeHtml(textOf(c, 'wp:cat_name'));
    if (usedCategories.has(title) && !textOf(c, 'wp:category_parent')) redirects.push({ from: `/category/${textOf(c, 'wp:category_nicename')}/`, to: categoryPath(title) });
  }

  // What the owner should know.
  for (const [what, { titles, which }] of lost) {
    const names = [...which];
    const named = names.length ? ` (${names.slice(0, 8).join(', ')}${names.length > 8 ? ` and ${names.length - 8} more` : ''})` : '';
    notes.push(`Changed or left out: ${what}${named}. In: ${list(titles)}.`);
  }
  if (held.size) notes.push(`Private and password-protected entries were imported as drafts, because a site here has no hidden pages: ${list(held)}.`);
  if (files.size) notes.push(`Links to files (a PDF, a download) still point at the old site, because only images are copied. Keep those files reachable or upload them elsewhere. In: ${list(files)}.`);
  if (strays.size) notes.push(`Some links lead to addresses on the old site that are not pages or posts (an archive, a tag, a plugin's page). They were left as they were. In: ${list(strays)}.`);
  if (elsewhere.size) notes.push(`Images kept on other sites stay where they are and are not copied. In: ${list(elsewhere)}.`);
  const comments = items.reduce((sum, item) => sum + item.comments, 0);
  if (comments) notes.push(`${count(comments, 'comment')} not imported: a site here has no comments.`);
  if (tags.size) notes.push(`${count(tags.size, 'tag')} not imported: posts here are grouped by category only.`);
  const other = new Map<string, number>();
  for (const item of items) if (!HOUSEKEEPING.has(item.type) && !typeOf.has(item.type) && live(item)) other.set(item.type, (other.get(item.type) ?? 0) + 1);
  for (const [type, n] of other) {
    notes.push(
      type === 'wp_block'
        ? `${count(n, 'reusable block')} (patterns) not imported; where a page used one, that part is missing.`
        : `${count(n, 'entry', 'entries')} of the kind "${type}" not imported: they belong to a plugin or theme of the old site. If they are content you want (a portfolio, a team), run the import again with --types=${type} to bring them as a content type.`,
    );
  }
  if (items.some((i) => i.type === 'page' && i.parent !== '0' && live(i))) notes.push('Pages that sat under other pages now sit at the top level (/services/web/ became /web/). Their old addresses lead to the new ones.');

  const language = textOf(channel, 'language');
  return { site: { name, language, url: /^https?:\/\//i.test(base) ? base : '' }, pages, posts, types, entries, menu, images: [...images], redirects, notes };
}
