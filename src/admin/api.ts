/** The admin's calls to the editing server. The token comes from the address the CLI printed. */
import type { Page, Site, Theme } from '../core/index.ts';

export interface PageInfo {
  slug: string;
  title: string;
  published: boolean;
  changed: boolean;
}
export interface State {
  site: Site;
  theme: Theme;
  themes: Theme[];
  pages: PageInfo[];
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
  page: (slug: string) => call<{ page: Page }>('GET', `/api/page?slug=${encodeURIComponent(slug)}`),
  save: (page: Page, create = false) => call<{ page: Page; pages: PageInfo[] }>('PUT', '/api/page', { page, create }),
  remove: (slug: string) => call<{ pages: PageInfo[] }>('DELETE', `/api/page?slug=${encodeURIComponent(slug)}`),
  publish: (slug: string) => call<{ pages: PageInfo[] }>('POST', '/api/publish', { slug }),
  render: (page: Page) => call<{ body: string; css: string }>('POST', '/api/render', { page }),
  setTheme: (theme: Theme) => call<State>('PUT', '/api/theme', { theme }),
};
