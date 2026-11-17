/**
 * From the menu as the owner arranged it to the links a page shows.
 *
 * This is where an item that points at a page meets the pages there are. An
 * item whose page does not exist (deleted, or not published yet when the site
 * is exported) is left out, with whatever it alone held. A menu never leads
 * to a page that is not there.
 */
import type { MenuNode } from './menu.ts';
import { MENU_DEPTH } from './menu.ts';
import { pagePath, type Site } from './page.ts';
import { blogPath } from './post.ts';

export interface MenuLink {
  title: string;
  /** Empty for a heading that only opens what is under it. */
  href: string;
  children: MenuLink[];
}

export interface MenuPage {
  slug: string;
  title: string;
  inMenu?: boolean;
}

/** The menu a site has before its owner arranges one: its pages in order, then the blog. */
export function automaticMenu(site: Site, pages: MenuPage[], hasPosts: boolean): MenuNode[] {
  const items: MenuNode[] = pages
    .filter((p) => p.inMenu !== false)
    .map((p) => ({ id: `auto-${p.slug || 'home'}`, label: '', target: { kind: 'page', slug: p.slug }, children: [] }));
  if (hasPosts) items.push({ id: 'auto-blog', label: '', target: { kind: 'blog' }, children: [] });
  return items;
}

export function resolveMenu(site: Site, pages: MenuPage[], hasPosts: boolean): MenuLink[] {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const walk = (nodes: MenuNode[], depth: number): MenuLink[] =>
    nodes.flatMap((node): MenuLink[] => {
      const children = depth < MENU_DEPTH ? walk(node.children, depth + 1) : [];
      let href = '';
      let fallback = '';
      if (node.target.kind === 'page') {
        const page = bySlug.get(node.target.slug);
        if (!page) return [];
        href = pagePath(page.slug);
        fallback = page.title;
      } else if (node.target.kind === 'blog') {
        if (!hasPosts) return [];
        href = blogPath();
        fallback = site.blogTitle;
      } else if (node.target.kind === 'url') {
        href = node.target.href;
      }
      const title = node.label || fallback;
      // Nothing to say, or nowhere to go and nothing to open: not an item.
      if (!title || (!href && children.length === 0)) return [];
      return [{ title, href, children }];
    });
  return walk(site.menu ?? automaticMenu(site, pages, hasPosts), 1);
}

/** Whether an item opens a wide panel of columns: it does when what is under it has items of its own. */
export const isMega = (link: MenuLink): boolean => link.children.some((child) => child.children.length > 0);

/** Whether this item, or anything under it, is the page being shown. */
export const holdsCurrent = (link: MenuLink, current: string): boolean =>
  (link.href !== '' && link.href === current) || link.children.some((child) => holdsCurrent(child, current));
