/** The admin's calls to the editing server. The token comes from the address the CLI printed. */
import type { Page, Post, Site, Theme } from '../core/index.ts';

/** What is being edited: a page or a blog post. Both are made of blocks. */
export type Kind = 'page' | 'post';
export type Doc = Page | Post;

export interface PageInfo {
  slug: string;
  title: string;
  published: boolean;
  changed: boolean;
}
export interface PostInfo extends PageInfo {
  date: string;
}
interface Lists {
  pages: PageInfo[];
  posts: PostInfo[];
}
export interface State {
  site: Site;
  theme: Theme;
  /** The theme being worked on differs from the published one. */
  themeChanged: boolean;
  themes: Theme[];
  pages: PageInfo[];
  posts: PostInfo[];
}

export interface MediaItem {
  name: string;
  path: string;
  type: string;
  size: number;
  label: string;
}

const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'x-thecms-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `request failed (${response.status})`);
  return data;
}

export const api = {
  hasToken: token !== '',
  state: () => call<State>('GET', '/api/state'),
  page: (slug: string, kind: Kind = 'page') => call<{ page: Doc }>('GET', `/api/page?kind=${kind}&slug=${encodeURIComponent(slug)}`),
  save: (page: Doc, create = false, kind: Kind = 'page') => call<{ page: Doc } & Lists>('PUT', '/api/page', { page, create, kind }),
  remove: (slug: string, kind: Kind = 'page') => call<Lists>('DELETE', `/api/page?kind=${kind}&slug=${encodeURIComponent(slug)}`),
  publish: (slug: string, kind: Kind = 'page') => call<Lists>('POST', '/api/publish', { slug, kind }),
  render: (page: Doc, kind: Kind = 'page') => call<{ body: string; css: string }>('POST', '/api/render', { page, kind }),
  setSite: (site: Site) => call<State>('PUT', '/api/site', { site }),
  setTheme: (theme: Theme) => call<State>('PUT', '/api/theme', { theme }),
  publishTheme: () => call<State>('POST', '/api/theme/publish', {}),
  media: () => call<{ media: MediaItem[] }>('GET', '/api/media'),
  removeMedia: (name: string) => call<{ media: MediaItem[] }>('DELETE', `/api/media?name=${encodeURIComponent(name)}`),
  /** The body is the file itself; the server reads what it is from its bytes. */
  async upload(file: Blob, label: string): Promise<{ item: MediaItem; media: MediaItem[] }> {
    const response = await fetch(`/api/media?label=${encodeURIComponent(label)}`, {
      method: 'POST',
      headers: { 'x-thecms-token': token, 'content-type': 'application/octet-stream' },
      body: file,
    });
    const data = (await response.json()) as { item: MediaItem; media: MediaItem[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? `request failed (${response.status})`);
    return data;
  },
};
