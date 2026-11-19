/** The admin's calls to the editing server. The token comes from the address the CLI printed. */
import type { Page, Post, Site, Theme } from '../core/index.ts';
import type { ImportPreview, ImportProgress } from '../site/server.ts';

export type { ImportPreview, ImportProgress };
import type { Message } from '../site/store.ts';
export type { Message };
export interface ImportChoices {
  /** Kinds of entry to bring as content types. */
  types: string[];
  /** Categories of posts to bring as content types of their own. */
  categories: string[];
  images: boolean;
  /** Take the site's name, language, address and menu from the old site. */
  settings: boolean;
}

/** What is being edited: `page`, or the name of a content type (`posts`, `projects`). All are made of blocks. */
export type Kind = string;
export type Doc = Page | Post;

export interface PageInfo {
  slug: string;
  title: string;
  /** Asked to be in the automatic menu. Posts have no such wish. */
  inMenu?: boolean;
  published: boolean;
  changed: boolean;
}
export interface PostInfo extends PageInfo {
  date: string;
}
/** A content type's own page (ADR 0015): whether it has one, and whether visitors see what is being worked on. */
export interface TemplateInfo {
  custom: boolean;
  published: boolean;
  changed: boolean;
}
interface Lists {
  templates: Record<string, TemplateInfo>;
  pages: PageInfo[];
  posts: PostInfo[];
  /** Each content type's entries, by the type's name. */
  entries: Record<string, PostInfo[]>;
}
export interface State {
  site: Site;
  theme: Theme;
  /** The theme being worked on differs from the published one. */
  themeChanged: boolean;
  themes: Theme[];
  /** English, and every language pack the installation has (ADR 0021). */
  languages: LanguageInfo[];
  templates: Record<string, TemplateInfo>;
  pages: PageInfo[];
  posts: PostInfo[];
  entries: Record<string, PostInfo[]>;
}

export interface LanguageInfo {
  language: string;
  name: string;
  /** How much of English the pack says, from 0 to 1. */
  coverage: number;
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

/** A file as the whole body of a call. */
async function send<T>(path: string, file: Blob): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'x-thecms-token': token, 'content-type': 'application/octet-stream' }, body: file });
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
  messages: () => call<{ messages: Message[]; keep: number }>('GET', '/api/messages'),
  messagesFrom: (email: string) => call<{ messages: Message[]; keep: number }>('GET', `/api/messages?email=${encodeURIComponent(email.trim())}`),
  removeMessage: (id: string) => call<{ messages: Message[]; keep: number }>('DELETE', `/api/messages?id=${encodeURIComponent(id)}`),
  eraseMessagesFrom: (email: string) => call<{ messages: Message[]; keep: number }>('DELETE', `/api/messages?email=${encodeURIComponent(email.trim())}`),
  removeMedia: (name: string) => call<{ media: MediaItem[] }>('DELETE', `/api/media?name=${encodeURIComponent(name)}`),
  importPlan: (file: Blob, types: string[], categories: string[]) =>
    send<ImportPreview>(`/api/import/plan?types=${encodeURIComponent(types.join(','))}&categories=${encodeURIComponent(categories.join(','))}`, file),
  importRun: (file: Blob, choices: ImportChoices) =>
    send<ImportProgress>(
      `/api/import/run?types=${encodeURIComponent(choices.types.join(','))}&categories=${encodeURIComponent(choices.categories.join(','))}&images=${choices.images ? 1 : 0}&settings=${choices.settings ? 1 : 0}`,
      file,
    ),
  importProgress: () => call<ImportProgress>('GET', '/api/import'),
  importForget: () => call<ImportProgress>('DELETE', '/api/import'),
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
