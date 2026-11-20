/**
 * The admin's calls to the editing server. On one's own computer they carry
 * the key from the address the command printed; on a served admin, the
 * session cookie and a header only the admin's own page sends (ADR 0022).
 */
import type { Block, ExtensionAction, Redirect, RedirectProblem, ExtensionCollection, Page, Post, Site, Theme } from '../core/index.ts';
import type { ViewDocument } from '../view/index.ts';
import type { ExtensionOffer } from '../site/extensions.ts';
import type { ImportPreview, ImportProgress } from '../site/server.ts';

export type { ImportPreview, ImportProgress };
import type { Message, Role, User } from '../site/store.ts';
export type { Message, Role, User };

/** The person signed in, as the admin is told. */
export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
}
export interface People {
  users: User[];
  me: Me;
  /** A one-time link just made, for the owner to send. */
  link?: string;
}

/** A call refused because nobody is signed in: the admin shows the sign-in form. */
export class SignInNeeded extends Error {}
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
  /** A page: the main page it is of, its language, and how it is translated (ADR 0032). */
  of?: string;
  language?: string;
  translated?: boolean;
  split?: boolean;
  /** How many of its texts still show the main language's words. */
  missing?: number;
}
/** What the builder is told of a page that is a translation (ADR 0032). */
export interface TranslationInfo {
  of: string;
  language: string;
  split: boolean;
}
/** A section (ADR 0033): where it is shown, and the languages it is translated into. */
export interface SectionInfo {
  slug: string;
  title: string;
  published: boolean;
  changed: boolean;
  usedOn: string[];
  languages: string[];
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
  sections: SectionInfo[];
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
  me: Me;
  /** The admin is served to others, with accounts; false on one's own computer. */
  accounts: boolean;
  extensions: ExtensionInfo[];
  templates: Record<string, TemplateInfo>;
  pages: PageInfo[];
  sections: SectionInfo[];
  posts: PostInfo[];
  entries: Record<string, PostInfo[]>;
}

/** An installed extension as the admin is told (ADR 0026). The owner is told more. */
export interface ExtensionInfo {
  name: string;
  displayName: string;
  description: string;
  version: string;
  publisher: string;
  enabled: boolean;
  actions: Pick<ExtensionAction, 'name' | 'label' | 'on' | 'ask' | 'each'>[];
  messages: Record<string, Record<string, string>>;
  sha256?: string;
  asks?: ExtensionOffer['asks'];
  views?: ViewDocument[];
  collections?: ExtensionCollection[];
}
export type { ExtensionOffer };

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
  width: number;
  height: number;
  /** The widths of its smaller copies (ADR 0005 d8). */
  variants: number[];
}

const hash = new URLSearchParams(location.hash.slice(1));
const token = hash.get('token') ?? '';
/** A one-time link's secret: the first owner, an invitation, a new password. */
export const linkSecret = hash.get('link') ?? '';
const who = (): Record<string, string> => (token ? { 'x-thecms-token': token } : { 'x-thecms-request': '1' });

async function answer<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string; signIn?: boolean };
  if (response.status === 401 && data.signIn) throw new SignInNeeded(data.error ?? 'sign in first');
  if (!response.ok) throw new Error(data.error ?? `request failed (${response.status})`);
  return data;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  return answer<T>(
    await fetch(path, {
      method,
      headers: { ...who(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/** A file as the whole body of a call. */
async function send<T>(path: string, file: Blob): Promise<T> {
  return answer<T>(await fetch(path, { method: 'POST', headers: { ...who(), 'content-type': 'application/octet-stream' }, body: file }));
}

export const api = {
  hasToken: token !== '',
  offerExtension: (file: Blob) => send<{ offer: ExtensionOffer }>('/api/extensions/offer', file),
  installExtension: (file: Blob, sha256: string) => send<{ extensions: ExtensionInfo[] }>(`/api/extensions/install?sha256=${sha256}`, file),
  enableExtension: (name: string, enabled: boolean) => call<{ extensions: ExtensionInfo[] }>('PUT', `/api/extensions/${name}`, { enabled }),
  uninstallExtension: (name: string) => call<{ extensions: ExtensionInfo[] }>('DELETE', `/api/extensions/${name}`),
  extensionRows: (name: string, collection: string) => call<{ rows: Record<string, unknown>[] }>('GET', `/api/extensions/${name}/rows/${collection}`),
  saveExtensionRow: (name: string, collection: string, row: Record<string, unknown>, id: string | null) => call<{ rows: Record<string, unknown>[] }>('PUT', `/api/extensions/${name}/rows/${collection}`, { id, row }),
  deleteExtensionRow: (name: string, collection: string, id: string) => call<{ rows: Record<string, unknown>[] }>('DELETE', `/api/extensions/${name}/rows/${collection}?id=${encodeURIComponent(id)}`),
  runExtensionAction: (name: string, action: string, input: Record<string, unknown>) => call<{ answer: unknown }>('POST', `/api/extensions/${name}/run/${action}`, { input }),
  runOnBlock: (name: string, action: string, block: Block, slug: string, ask: Record<string, string>, fixed = false) => call<{ block: Block }>('POST', `/api/extensions/${name}/run/${action}`, { block, slug, ask, fixed }),
  runOnPage: (name: string, action: string, page: Doc, ask: Record<string, string>, fixed = false) => call<{ page: Page }>('POST', `/api/extensions/${name}/run/${action}`, { page, ask, fixed }),
  runEachLanguage: (name: string, action: string, slug: string, kind: Kind, ask: Record<string, string>) => call<{ done: string[]; skipped: string[] } & Lists>('POST', `/api/extensions/${name}/each/${action}`, { slug, kind, ask }),
  state: () => call<State>('GET', '/api/state'),
  move: (from: string, to: string) => call<{ page: Page } & Lists>('POST', '/api/move', { from, to }),
  redirects: () => call<{ redirects: Redirect[] }>('GET', '/api/redirects'),
  setRedirects: (redirects: Redirect[]) => call<{ redirects: Redirect[] }>('PUT', '/api/redirects', { redirects }),
  page: (slug: string, kind: Kind = 'page') => call<{ page: Doc; translation?: TranslationInfo }>('GET', `/api/page?kind=${kind}&slug=${encodeURIComponent(slug)}`),
  translate: (slug: string, language: string, kind: Kind = 'page') => call<{ page: Page; translation: TranslationInfo } & Lists>('POST', '/api/translate', { slug, language, kind }),
  split: (of: string, language: string, kind: Kind = 'page') => call<{ page: Page; translation: TranslationInfo } & Lists>('POST', '/api/split', { of, language, kind }),
  check: () => call<{ check: { broken: { href: string; from: string[] }[]; unnamed: { src: string; on: string[] }[]; untranslated?: { slug: string; language: string; missing: number }[]; redirects?: RedirectProblem[] } }>('GET', '/api/check'),
  versions: (slug: string, kind: Kind = 'page') => call<{ versions: { at: string; title: string }[] }>('GET', `/api/versions?kind=${kind}&slug=${encodeURIComponent(slug)}`),
  version: (slug: string, at: string, kind: Kind = 'page') => call<{ page: Doc }>('GET', `/api/version?kind=${kind}&slug=${encodeURIComponent(slug)}&at=${encodeURIComponent(at)}`),
  save: (page: Doc, create = false, kind: Kind = 'page', translation: TranslationInfo | null = null) => call<{ page: Doc; translation?: TranslationInfo } & Lists>('PUT', '/api/page', { page, create, kind, ...(translation ? { translation } : {}) }),
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
    return send(`/api/media?label=${encodeURIComponent(label)}`, file);
  },
  /** A smaller copy of a stored picture, made here (ADR 0005 d8). */
  addVariant: (name: string, file: Blob) => send<{ item: MediaItem }>(`/api/media/variant?name=${encodeURIComponent(name)}`, file),
  signIn: (email: string, password: string) => call<{ me: Me }>('POST', '/api/session', { email, password }),
  signOut: () => call<{ signedOut: boolean }>('DELETE', '/api/session'),
  link: (secret: string) => call<{ kind: 'setup' | 'invite' | 'reset'; email: string; name: string }>('POST', '/api/link', { secret }),
  useLink: (secret: string, fields: { name?: string; email?: string; password: string }) => call<{ me: Me }>('POST', '/api/link/use', { secret, ...fields }),
  people: () => call<People>('GET', '/api/users'),
  invite: (email: string, role: Role) => call<People>('POST', '/api/users', { email, role }),
  newLink: (id: string) => call<People>('POST', '/api/users/link', { id }),
  setRole: (id: string, role: Role) => call<People>('PUT', '/api/users', { id, role }),
  removeUser: (id: string) => call<People>('DELETE', `/api/users?id=${encodeURIComponent(id)}`),
};
