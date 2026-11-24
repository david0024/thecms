<script lang="ts">
/**
 * The editor. It holds one page as a document, changes it only through the
 * core's tree operations, and asks the server to draw it. The canvas in the
 * middle is the real page; `frame.ts` runs inside it.
 */
import { onMount } from 'svelte';
import {
  type Block,
  type ContentType,
  contentTypes,
  entryPath,
  pageDescription,
  pagePath,
  postDescription,
  listPath,
  type MenuList,
  POSTS_TYPE,
  ENTRY_PARTS,
  type BlockDef,
  BLOCKS,
  type BlockStyle,
  type BlockType,
  countFreeValues,
  createBlock,
  duplicate,
  findById,
  fits,
  insertAt,
  isBlockType,
  isContainerType,
  moveTo,
  nudge,
  type Page,
  type Post,
  type Site,
  type Theme,
  parentIdOf,
  patchById,
  removeById,
  resetToTheme,
  slugify,
  slugIn,
  pagesIn,
  languageName,
  prefixOf,
  SECTION_KIND,
  languageOf,
  type Layout,
  READY_LAYOUTS,
  STANDARD,
  typeIn,
} from '../core/index.ts';
import { api, signedIn, type Doc, type Kind, type PostInfo, type State, type TranslationInfo } from './api.ts';
import ContentList from './ContentList.svelte';
import Layouts from './Layouts.svelte';
import { layoutName } from './layouts.ts';
import { BLOCK_GROUPS, BLOCK_WORDS, matches } from './blockGroups.ts';
import Extensions from './Extensions.svelte';
import ExtensionScreen from './ExtensionScreen.svelte';
import { findView } from '../view/index.ts';
import ExtensionTools from './ExtensionTools.svelte';
import SiteCheck from './SiteCheck.svelte';
import Sections from './Sections.svelte';
import Schedule from './Schedule.svelte';
import Versions from './Versions.svelte';
import ContentTypes from './ContentTypes.svelte';
import EntryFieldsForm from './EntryFieldsForm.svelte';
import ProductForm from './ProductForm.svelte';
import ImageField from './ImageField.svelte';
import ImportScreen from './ImportScreen.svelte';
import ExportScreen from './ExportScreen.svelte';
import MediaLibrary from './MediaLibrary.svelte';
import People from './People.svelte';
import Profile from './Profile.svelte';
import Reviews from './Reviews.svelte';
import Messages from './Messages.svelte';
import Orders from './Orders.svelte';
import Backups from './Backups.svelte';
import Stats from './Stats.svelte';
import Forms from './Forms.svelte';
import Comments from './Comments.svelte';
import PageLock from './PageLock.svelte';
import Audience from './Audience.svelte';
import Fields from './Fields.svelte';
import { adminLanguage, say, t } from './messages.ts';
import { setPath } from './paths.ts';
import SeoPanel from './SeoPanel.svelte';
import SitePanel from './SitePanel.svelte';
import StylePanel from './StylePanel.svelte';
import ThemeBuilder from './ThemeBuilder.svelte';

let site = $state.raw<State | null>(null);
/** What is open in the editor: a page or a blog post. */
let page = $state.raw<Doc | null>(null);
let kind = $state<Kind>('page');
/** The page being written is a translation of another (ADR 0032): its words only, unless it is split. */
let translation = $state<TranslationInfo | null>(null);
const fixed = $derived(translation !== null && !translation.split);
/** Which section of the admin is showing: a list, or the builder with one page or post open. */
let view = $state<'pages' | 'sections' | 'forms' | 'layouts' | 'media' | 'messages' | 'orders' | 'backups' | 'stats' | 'comments' | 'people' | 'me' | 'review' | 'types' | 'import' | 'export' | 'extensions' | 'edit' | `list:${string}` | `ext:${string}`>('pages');
let selected = $state<string | null>(null);
/** The form the Forms screen opens on, when a form block asked for it (ADR 0049). */
let formAsked = $state('');
let tab = $state<'content' | 'style'>('content');
let saving = $state<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
let failure = $state('');
let themeMode = $state(false);
let siteMode = $state(false);
let past = $state.raw<Block[][]>([]);
let future = $state.raw<Block[][]>([]);

let frame: HTMLIFrameElement | undefined = $state();
let frameReady = false;
let themeVersion = 0;
/** The canvas as a phone or a tablet shows the page: the same page, narrower. */
const DEVICES = ['wide', 'tablet', 'phone'] as const;
const WIDTHS: Record<(typeof DEVICES)[number], string | undefined> = { wide: undefined, tablet: '820px', phone: '390px' };
let device = $state<(typeof DEVICES)[number]>('wide');
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let renderTimer: ReturnType<typeof setTimeout> | undefined;
let themeTimer: ReturnType<typeof setTimeout> | undefined;
let siteTimer: ReturnType<typeof setTimeout> | undefined;
/** The last text typed on the canvas, so one stretch of typing is one undo step. */
let typing = { key: '', at: 0 };

const block = $derived(page && selected ? findById(page.blocks, selected) : null);
const def = $derived(block ? (BLOCKS[block.type] as BlockDef) : null);
const types = $derived(site ? contentTypes(site.site) : []);
/** The content type of what is open; none for a page. */
/** A content type's own page is open (ADR 0015), not a page or an entry. */
const designing = $derived(kind.startsWith('template:'));
const designed = $derived<ContentType | undefined>(designing ? types.find((ty) => `template:${ty.id}` === kind) : undefined);
/** A section is being written (ADR 0033). */
const sectioning = $derived(kind === SECTION_KIND);
const type = $derived<ContentType | undefined>(kind === 'page' || designing || sectioning ? undefined : types.find((ty) => ty.id === kind));
// The entries that link to the one open (ADR 0052 d4), said beside its delete button.
const usedBy = $derived<string[]>(type && !designed ? ((site?.entries[type.id]?.find((p) => p.slug === page?.slug)?.usedBy) ?? []) : []);
const info = $derived(
  designed
    ? site?.templates[designed.id]
    : // An entry's translation is published with its entry (ADR 0054).
      (type ? site?.entries[type.id] : site?.pages)?.find((p) => p.slug === page?.slug || (!!type && !!translation && p.slug === translation.of)),
);
/** What the entry block can show on the page being designed: the parts every entry has, then the type's own fields. */
const parts = $derived(designed ? [...ENTRY_PARTS.map((part) => ({ id: part, name: t.parts[part] ?? part })), ...designed.fields.map((f) => ({ id: `field:${f.key}`, name: f.label }))] : []);
/** The lists a menu can lead to: each content type that has an entry. */
const menuLists = $derived<MenuList[]>(types.filter((ty) => (site?.entries[ty.id]?.length ?? 0) > 0).map((ty) => ({ id: ty.id, title: ty.name, href: listPath(ty) })));
/** The list the open page or entry came from. */
const home = $derived<typeof view>(designing ? 'types' : sectioning ? 'sections' : kind === 'page' ? 'pages' : `list:${kind}`);
/** An editor writes and publishes content; the site, the theme and the people are the owner's (ADR 0022). */
const owner = $derived(site?.me.role === 'owner');
/** The owner and the editors write the whole site; an author and a contributor only their own entries (ADR 0055 d1). */
const staff = $derived(site?.me.role === 'owner' || site?.me.role === 'editor');
/** A contributor publishes nothing: their entries are sent for review (ADR 0055 d4). */
const contributor = $derived(site?.me.role === 'contributor');
/** The entries a list shows: all of them, or for an author and a contributor their own. */
const listedOf = (id: string): PostInfo[] => (site?.entries[id] ?? []).filter((e) => staff || e.author === site?.me.id);
/** Where the open entry is in its review, if anywhere. */
const review = $derived(info && 'review' in info ? (info as PostInfo).review : undefined);
/** The note an editor writes to send an entry back. */
let returnNote = $state('');
/** How many entries wait to be read (ADR 0055 d4). */
const waiting = $derived(site ? Object.values(site.entries).flat().filter((e) => e.review?.state === 'waiting').length : 0);
const freeOnPage = $derived(page ? countFreeValues(page.blocks) : 0);
/** Where visitors find what is open: none for a section or a content type's own page, which have no address. */
const publicPath = $derived(
  !page || !site || designing || sectioning
    ? ''
    : type
      ? translation
        ? entryPath(typeIn(site.site, type, translation.language), page.slug.slice(prefixOf(translation.language).length + 1))
        : entryPath(type, page.slug)
      : pagePath(page.slug),
);

/** The site's languages, as a question of an extension offers them. */
const siteLanguages = $derived(site ? [site.site.language, ...site.site.languages].map((language) => ({ language, name: languageName(language) })) : []);

/** An extension's answer on the block being edited: put in its place, as one step to undo. */
async function runOnBlock(name: string, action: string, ask: Record<string, string>): Promise<void> {
  if (!page || !block) return;
  const id = block.id;
  try {
    const { block: next } = await api.runOnBlock(name, action, block, page.slug, ask, fixed);
    failure = '';
    patch(id, () => next);
  } catch (error) {
    fail(error);
  }
}
/** An extension's answer on the page: its title, description and blocks, as one step to undo. */
async function runOnPage(name: string, action: string, ask: Record<string, string>): Promise<void> {
  if (!page) return;
  try {
    const { page: next } = await api.runOnPage(name, action, page, ask, fixed);
    failure = '';
    // Words only: a title for search engines the action wrote (ADR 0059 d1), never the picture or the choice to hide.
    change({ ...page, title: next.title || page.title, description: next.description, blocks: next.blocks, ...(next.seoTitle ? { seoTitle: next.seoTitle } : {}) });
  } catch (error) {
    fail(error);
  }
}

/** On a page of the main language, an action for each language runs on every translation of it (ADR 0034). */
const everyLanguage = $derived(!!site && !!page && !translation && !designing && site.site.languages.length > 0 && (sectioning || !!type || (kind === 'page' && languageOf(site.site, page.slug) === site.site.language)));
/** Saves the page, then fills in what each translation does not say yet; says which languages it did. */
async function runEveryLanguage(name: string, action: string, ask: Record<string, string>): Promise<string> {
  if (!page || !site) return '';
  try {
    await save();
    const { done, skipped, pages, sections, posts, entries, templates } = await api.runEachLanguage(name, action, page.slug, kind, ask);
    site = { ...site, pages, sections, posts, entries, templates };
    failure = '';
    const names = (list: string[]): string => list.map(languageName).join(', ');
    return [done.length ? say(t.ext.eachDone, { languages: names(done) }) : '', skipped.length ? say(t.ext.eachSplit, { languages: names(skipped) }) : ''].filter(Boolean).join(' ');
  } catch (error) {
    fail(error);
    return '';
  }
}

const fail = (error: unknown): void => {
  failure = error instanceof Error ? error.message : String(error);
};

async function draw(): Promise<void> {
  if (!page || !frameReady || !frame?.contentWindow) return;
  try {
    const { body, css } = await api.render(page, kind);
    frame.contentWindow.postMessage(
      { type: 'render', body, css, selected, themeVersion, labels: { types: t.types, fields: t.fields, empty: t.empty, actions: t.actions, format: t.format } },
      location.origin,
    );
  } catch (error) {
    fail(error);
  }
}

function scheduleSave(): void {
  saving = 'unsaved';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

async function save(): Promise<void> {
  clearTimeout(saveTimer);
  if (!page || !site) return;
  const sent = page;
  saving = 'saving';
  try {
    const { pages, sections, posts, entries, templates } = await api.save(sent, false, kind, translation);
    site = { ...site, pages, sections, posts, entries, templates };
    // Something may have changed while the request was out; then it is not saved yet.
    saving = page === sent ? 'saved' : 'unsaved';
    failure = '';
  } catch (error) {
    saving = 'error';
    fail(error);
  }
}

/** Every change to the page goes through here. */
function change(next: Doc, options: { redraw?: boolean; step?: boolean } = {}): void {
  if (!page) return;
  if (options.step !== false) {
    past = [...past.slice(-99), page.blocks];
    future = [];
  }
  page = next;
  scheduleSave();
  if (options.redraw !== false) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(draw, 120);
  }
}

const setBlocks = (blocks: Block[], options?: { redraw?: boolean; step?: boolean }): void => {
  if (page && blocks !== page.blocks) change({ ...page, blocks }, options);
};

function undo(): void {
  const previous = past[past.length - 1];
  if (!page || !previous) return;
  past = past.slice(0, -1);
  future = [...future, page.blocks];
  change({ ...page, blocks: previous }, { step: false });
}

function redo(): void {
  const next = future[future.length - 1];
  if (!page || !next) return;
  future = future.slice(0, -1);
  past = [...past, page.blocks];
  change({ ...page, blocks: next }, { step: false });
}

/** Puts a new block at a place. Deeper than a page allows, it is refused and the author is told. */
function insert(type: BlockType, parent: string | null, index: number, content: Record<string, unknown> = {}): void {
  if (layoutFixed()) return;
  if (!page) return;
  const fresh = { ...createBlock(type) };
  fresh.content = { ...fresh.content, ...content };
  if (!fits(page.blocks, parent, fresh)) {
    failure = t.app.tooDeep;
    return;
  }
  failure = '';
  setBlocks(insertAt(page.blocks, parent, index, fresh));
  selected = fresh.id;
  tab = 'content';
}

/** A new block goes into the selected group, else right after the selected block, else at the end. */
function add(type: BlockType, content: Record<string, unknown> = {}): void {
  if (!page) return;
  const current = selected ? findById(page.blocks, selected) : null;
  if (current && isContainerType(current.type)) {
    insert(type, current.id, current.children?.length ?? 0, content);
  } else if (current) {
    const parent = parentIdOf(page.blocks, current.id) ?? null;
    const siblings = parent ? (findById(page.blocks, parent)?.children ?? []) : page.blocks;
    insert(type, parent, siblings.findIndex((b) => b.id === current.id) + 1, content);
  } else {
    insert(type, null, page.blocks.length, content);
  }
}

/** The blocks the extensions that are on add (ADR 0062 d6), each offered in the list by its own name. */
const extensionBlocks = $derived(
  (site?.extensions ?? [])
    .filter((e) => e.enabled)
    .flatMap((e) => (e.blocks ?? []).map((b) => ({ id: `${e.name}/${b.name}`, label: e.messages[adminLanguage()]?.[b.label] || e.messages[adminLanguage().split('-')[0] ?? '']?.[b.label] || b.label }))),
);

/** What is typed in the search over "Add a block" (ADR 0073). */
let blockQuery = $state('');
/** The blocks offered, group by group, as the search leaves them; a group left empty is not shown. */
const blockGroups = $derived(
  [
    ...BLOCK_GROUPS.map((group) => ({
      id: group.id,
      types: group.types.filter((ty) => (ty !== 'entry' || designing) && matches(blockQuery, t.types[ty] ?? ty, t.blockNames[ty] ?? '', t.blockHints[ty] ?? '', BLOCK_WORDS[ty] ?? '', ty)),
      extensions: [] as { id: string; label: string }[],
    })),
    { id: 'extensions', types: [] as BlockType[], extensions: extensionBlocks.filter((one) => matches(blockQuery, one.label, one.id)) },
  ].filter((group) => group.types.length + group.extensions.length > 0),
);

/** A block dropped at a place on the page. `index` counts the blocks there with the moved one left out. */
function move(id: string, parent: string | null, index: number): void {
  if (layoutFixed()) return;
  if (!page) return;
  const moved = findById(page.blocks, id);
  if (!moved) return;
  const from = parentIdOf(page.blocks, id) ?? null;
  const siblings = from ? (findById(page.blocks, from)?.children ?? []) : page.blocks;
  // Dropped where it already was: nothing to do, and nothing to undo.
  if (from === parent && siblings.findIndex((b) => b.id === id) === index) return;
  if (parent !== null && !fits(page.blocks, parent, moved)) {
    failure = t.app.tooDeep;
    return;
  }
  failure = '';
  selected = id;
  setBlocks(moveTo(page.blocks, id, parent, index));
}

function act(id: string, action: 'up' | 'down' | 'duplicate' | 'delete'): void {
  if (!page || layoutFixed()) return;
  if (action === 'up') setBlocks(nudge(page.blocks, id, -1));
  else if (action === 'down') setBlocks(nudge(page.blocks, id, 1));
  else if (action === 'duplicate') setBlocks(duplicate(page.blocks, id));
  else {
    if (selected === id) selected = null;
    setBlocks(removeById(page.blocks, id));
  }
}

const patch = (id: string, fn: (b: Block) => Block, options?: { redraw?: boolean; step?: boolean }): void => {
  if (page) setBlocks(patchById(page.blocks, id, fn), options);
};

function onFrameMessage(event: MessageEvent): void {
  if (event.origin !== location.origin || event.source !== frame?.contentWindow || event.data?.uhlaka !== true) return;
  const message = event.data as { type: string; id: string | null; path: string; value: unknown; action: 'up'; parent: string | null; index: number; blockType: string };
  const place = (): boolean => (message.parent === null || typeof message.parent === 'string') && Number.isInteger(message.index);
  if (message.type === 'ready') {
    frameReady = true;
    draw();
  } else if (message.type === 'site') {
    themeMode = false;
    siteMode = true;
  } else if (message.type === 'select') {
    selected = message.id;
  } else if (message.type === 'edit' && message.id) {
    // Typed on the page: the page already shows it, so nothing is redrawn.
    const key = `${message.id}:${message.path}`;
    const step = key !== typing.key || Date.now() - typing.at > 1500;
    typing = { key, at: Date.now() };
    patch(message.id, (b) => ({ ...b, content: setPath(b.content, message.path, message.value) }), { redraw: false, step });
  } else if (message.type === 'action' && message.id) {
    act(message.id, message.action);
  } else if (message.type === 'move' && message.id && place()) {
    move(message.id, message.parent, message.index);
  } else if (message.type === 'insert' && message.blockType.startsWith('extension:') && place()) {
    // A block an extension adds, dragged in from the list by its own name (ADR 0062 d6).
    insert('extension', message.parent, message.index, { block: message.blockType.slice('extension:'.length) });
  } else if (message.type === 'insert' && isBlockType(message.blockType) && place()) {
    insert(message.blockType, message.parent, message.index);
  }
}

async function open(slug: string, next: Kind = 'page'): Promise<void> {
  try {
    if (saving !== 'saved') await save();
    const opened = await api.page(slug, next);
    kind = next;
    page = opened.page;
    translation = opened.translation ?? null;
    selected = null;
    past = [];
    future = [];
    saving = 'saved';
    await draw();
  } catch (error) {
    fail(error);
  }
}

/** Chosen from a list: opened in the builder. */
async function edit(slug: string, next: Kind): Promise<void> {
  await open(slug, next);
  view = 'edit';
}

/** A section that lives on the page itself: the builder, with that panel open. */
async function panel(which: 'site' | 'theme'): Promise<void> {
  view = 'edit';
  if (which === 'site' && !siteMode) await toggleSite();
  if (which === 'theme' && !themeMode) await toggleTheme();
}

/**
 * Each screen has an address of its own, after the key in the address's end:
 * `#at=media`, `#at=edit/page/about`. Reloading keeps the screen, Back goes to
 * the one before, and a screen opens in a new tab. The key stays where it is.
 */
const AT = 'at';
const SCREENS = new Set(['pages', 'sections', 'forms', 'layouts', 'media', 'messages', 'orders', 'backups', 'stats', 'comments', 'people', 'me', 'review', 'types', 'import', 'export', 'extensions']);
/** Set while an address is being followed, so following it does not write a new one. */
let following = false;
/** Addresses are written once the one the admin was opened at has been followed. */
let routed = $state(false);
const here = $derived(view !== 'edit' ? view : siteMode ? 'settings' : themeMode ? 'theme' : page ? `edit/${kind}/${page.slug}` : 'pages');

$effect(() => {
  const at = here;
  if (!routed || following) return;
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get(AT) === at) return;
  const first = !params.has(AT);
  params.delete(AT);
  // Written by hand so the address reads as it is: `at=edit/page/about`, not `at=edit%2Fpage%2Fabout`.
  const rest = params.toString();
  const next = `${location.pathname}${location.search}#${rest ? `${rest}&` : ''}${AT}=${encodeURIComponent(at).replaceAll('%2F', '/').replaceAll('%3A', ':')}`;
  if (first) history.replaceState(history.state, '', next);
  else history.pushState(history.state, '', next);
});

/** Opens the screen an address names; one it does not know, or that is not this person's, leaves things as they are. */
async function follow(): Promise<void> {
  const at = new URLSearchParams(location.hash.slice(1)).get(AT);
  if (!at || at === here || !site) return;
  following = true;
  try {
    if (at === 'settings' || at === 'theme') {
      if (owner) await panel(at === 'settings' ? 'site' : 'theme');
    } else if (at.startsWith('edit/')) {
      const rest = at.slice('edit/'.length);
      const cut = rest.indexOf('/');
      const next = (cut < 0 ? rest : rest.slice(0, cut)) as Kind;
      const slug = cut < 0 ? '' : rest.slice(cut + 1);
      if (siteMode) await toggleSite();
      themeMode = false;
      if (!page || next !== kind || slug !== page.slug) await open(slug, next);
      view = 'edit';
    } else if (SCREENS.has(at) || (at.startsWith('list:') && types.some((ty) => `list:${ty.id}` === at)) || (at.startsWith('ext:') && site.extensions.some((e) => at.startsWith(`ext:${e.name}/`)))) {
      if (siteMode) await toggleSite();
      themeMode = false;
      view = at as typeof view;
    }
  } finally {
    following = false;
  }
}

async function createPage(title: string, newKind: Kind, layout = ''): Promise<void> {
  const slug = slugify(title);
  if (!site || !title || !slug) return;
  try {
    // An entry without a date is dated today by the server.
    const fresh = newKind === 'page' || newKind === SECTION_KIND ? { slug, title, description: '', inMenu: newKind === 'page', blocks: [], ...(layout && layout !== STANDARD ? { layout } : {}) } : ({ slug, title, blocks: [] } as unknown as Post);
    const { pages, sections, posts, entries, templates } = await api.save(fresh, true, newKind);
    site = { ...site, pages, sections, posts, entries, templates };
    await edit(slug, newKind);
  } catch (error) {
    fail(error);
  }
}

/** A page in another language (ADR 0032): its words written over the main page's, opened in the builder. */
async function translatePage(slug: string, language: string, of: Kind = 'page'): Promise<void> {
  if (!site) return;
  try {
    const { page: started, pages, sections, posts, entries, templates } = await api.translate(slug, language, of);
    site = { ...site, pages, sections, posts, entries, templates };
    await edit(started.slug, of);
  } catch (error) {
    fail(error);
  }
}

/** Splits the translation being written (ADR 0032 d4): its blocks become its own. */
async function splitPage(): Promise<void> {
  if (!site || !translation) return;
  try {
    await save();
    const { page: split, translation: now, pages, sections, posts, entries, templates } = await api.split(translation.of, translation.language, kind);
    site = { ...site, pages, sections, posts, entries, templates };
    page = split;
    translation = now;
    await draw();
  } catch (error) {
    fail(error);
  }
}

/** A translation keeps the main page's blocks: what would change them is said, not done. */
function layoutFixed(): boolean {
  if (fixed) failure = t.inspector.translationNote;
  return fixed;
}

async function removePage(): Promise<void> {
  if (!site || !page || (kind === 'page' && page.slug === '')) return;
  try {
    clearTimeout(saveTimer);
    saving = 'saved';
    const { pages, sections, posts, entries, templates } = await api.remove(page.slug, kind);
    site = { ...site, pages, sections, posts, entries, templates };
    view = home;
    await open('');
  } catch (error) {
    fail(error);
  }
}

async function publish(): Promise<void> {
  if (!site || !page) return;
  try {
    await save();
    if (saving !== 'saved') return;
    const { pages, sections, posts, entries, templates } = await api.publish(page.slug, kind);
    site = { ...site, pages, sections, posts, entries, templates };
  } catch (error) {
    fail(error);
  }
}

/** A contributor's entry, saved and sent to be read (ADR 0055 d4). */
async function askReview(): Promise<void> {
  if (!site || !page) return;
  try {
    await save();
    if (saving !== 'saved') return;
    const { pages, sections, posts, entries, templates } = await api.askReview(page.slug, kind);
    site = { ...site, pages, sections, posts, entries, templates };
  } catch (error) {
    fail(error);
  }
}

/** Sent back to its contributor with a note, by an owner or an editor. */
async function returnReview(note: string): Promise<void> {
  if (!site || !page) return;
  try {
    const { pages, sections, posts, entries, templates } = await api.returnReview(page.slug, kind, note);
    site = { ...site, pages, sections, posts, entries, templates };
  } catch (error) {
    fail(error);
  }
}

/** Gives the open entry to someone else (ADR 0055 d2): the owner's and the editors' choice. */
async function setAuthor(id: string): Promise<void> {
  if (!site || !page) return;
  try {
    const { pages, sections, posts, entries, templates } = await api.setAuthor(page.slug, kind, id);
    site = { ...site, pages, sections, posts, entries, templates };
    await draw();
  } catch (error) {
    fail(error);
  }
}

async function chooseTheme(name: string): Promise<void> {
  const theme = site?.themes.find((th) => th.name === name);
  if (!site || !theme) return;
  try {
    site = await api.setTheme(theme);
    themeVersion += 1;
    await draw();
  } catch (error) {
    fail(error);
  }
}

/**
 * A theme the builder has already checked. The admin shows it at once; the
 * server gets it a moment later, and then the canvas fetches the stylesheet
 * again. This is the theme being worked on: visitors see it after "Publish theme".
 */
function editTheme(theme: Theme): void {
  if (!site) return;
  site = { ...site, theme, themeChanged: true };
  clearTimeout(themeTimer);
  themeTimer = setTimeout(async () => {
    try {
      site = await api.setTheme(theme);
      themeVersion += 1;
      await draw();
    } catch (error) {
      fail(error);
    }
  }, 250);
}

/**
 * The site's settings as they are being typed. The admin keeps what was typed
 * (a link with no address yet is not a link to the server, but it is not to be
 * taken from under the author's hands); the server's cleaned copy is taken
 * when the panel closes.
 */
function editSite(next: Site): void {
  if (!site) return;
  site = { ...site, site: next };
  clearTimeout(siteTimer);
  siteTimer = setTimeout(async () => {
    try {
      const answer = await api.setSite(next);
      if (site) site = { ...answer, site: siteMode ? site.site : answer.site };
      await draw();
    } catch (error) {
      fail(error);
      // What was refused is not kept on the screen either: the panel shows what is saved.
      if (site) site = { ...site, site: (await api.state()).site };
    }
  }, 250);
}

/** The admin in another language: saved at once, then opened again, since its words are read when it starts. */
async function setAdminLanguage(adminLanguage: string): Promise<void> {
  if (!site) return;
  clearTimeout(siteTimer);
  try {
    await api.setSite({ ...site.site, adminLanguage });
    location.reload();
  } catch (error) {
    fail(error);
  }
}

/** The page at another address (ADR 0036): saved first, then moved; the old address leads to the new one. */
async function movePage(input: HTMLInputElement): Promise<void> {
  if (!page || !site || kind !== 'page') return;
  const from = page.slug;
  try {
    await save();
    const { page: moved } = await api.move(from, input.value);
    // The menu follows the page, so the site is read again.
    site = await api.state();
    await edit(moved.slug, 'page');
  } catch (error) {
    input.value = from;
    fail(error);
  }
}

/** The layouts as the owner set them (ADR 0035). Answers with the reason when the site refuses, '' when it took them. */
async function saveLayouts(next: Layout[]): Promise<string> {
  if (!site) return '';
  try {
    site = await api.setSite({ ...site.site, layouts: next });
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The content types as the owner set them. Answers with the reason when the site refuses, '' when it took them. */
async function saveTypes(next: ContentType[]): Promise<string> {
  if (!site) return '';
  try {
    site = await api.setSite({ ...site.site, types: next });
    await draw();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function signOut(): Promise<void> {
  try {
    await api.signOut();
  } finally {
    location.reload();
  }
}

/** The site was changed by something other than this screen (an import): read it again. */
/** From a form block to its form, on the Forms screen. */
function openForm(name: string): void {
  formAsked = name;
  view = 'forms';
}

async function reload(): Promise<void> {
  try {
    site = await api.state();
    await draw();
  } catch (error) {
    fail(error);
  }
}

async function toggleSite(): Promise<void> {
  siteMode = !siteMode;
  themeMode = false;
  if (siteMode || !site) return;
  try {
    clearTimeout(siteTimer);
    site = await api.setSite(site.site);
    await draw();
  } catch (error) {
    fail(error);
  }
}

async function toggleTheme(): Promise<void> {
  const next = !themeMode;
  if (siteMode) await toggleSite();
  themeMode = next;
}

async function publishTheme(): Promise<void> {
  try {
    site = await api.publishTheme();
  } catch (error) {
    fail(error);
  }
}

function onKey(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
  const target = event.target as HTMLElement;
  if (target.matches('input, textarea, select')) return;
  event.preventDefault();
  if (event.shiftKey) redo();
  else undo();
}

onMount(() => {
  window.addEventListener('message', onFrameMessage);
  window.addEventListener('popstate', follow);
  (async () => {
    try {
      site = await api.state();
      await open('');
      // An author and a contributor start at their own entries: the pages are not theirs (ADR 0055 d1).
      signedIn.staff = staff;
      if (!staff) view = `list:${types.find((ty) => ty.id === POSTS_TYPE)?.id ?? types[0]?.id ?? ''}`;
      await follow();
      routed = true;
    } catch (error) {
      fail(error);
    }
  })();
  return () => {
    window.removeEventListener('message', onFrameMessage);
    window.removeEventListener('popstate', follow);
  };
});
</script>

<svelte:window onkeydown={onKey} />

{#if !site || !page}
  <p class="notice">{failure || '…'}</p>
{:else}
  <div class="editor admin" class:building={view === 'edit'}>
    <!-- Like a page builder elsewhere, the builder takes the whole window: the page needs the width. -->
    <nav class="rail" aria-label={t.nav.label} hidden={view === 'edit'}>
      <!-- The way out to the site, as visitors see it, in a tab of its own (like the admin bar elsewhere). -->
      <a class="site" href="/" target="_blank" rel="noopener" data-view-site><strong>{site.site.name}</strong><small>{t.nav.viewSite} ↗</small></a>
      {#if staff}
      <button type="button" aria-current={view === 'pages' ? 'page' : undefined} onclick={() => (view = 'pages')} data-nav="pages">{t.nav.pages}</button>
      {/if}
      {#each types as ty (ty.id)}
        <button type="button" aria-current={view === `list:${ty.id}` ? 'page' : undefined} onclick={() => (view = `list:${ty.id}`)} data-nav={ty.id}>{ty.name}</button>
      {/each}
      {#if staff}
      <button type="button" aria-current={view === 'review' ? 'page' : undefined} onclick={() => (view = 'review')} data-nav="review">{t.nav.review}{waiting ? ` (${waiting})` : ''}</button>
      <button type="button" aria-current={view === 'sections' ? 'page' : undefined} onclick={() => (view = 'sections')} data-nav="sections">{t.nav.sections}</button>
      {/if}
      <button type="button" aria-current={view === 'media' ? 'page' : undefined} onclick={() => (view = 'media')} data-nav="media">{t.nav.media}</button>
      {#if staff}
      <button type="button" aria-current={view === 'stats' ? 'page' : undefined} onclick={() => (view = 'stats')} data-nav="stats">{t.nav.stats}</button>
      {/if}
      {#if staff && types.some((ty) => ty.comments)}
        <button type="button" aria-current={view === 'comments' ? 'page' : undefined} onclick={() => (view = 'comments')} data-nav="comments">{t.nav.comments}</button>
      {/if}
      {#if site.shop.on && (owner || (staff && site.shop.editors))}
        <button type="button" aria-current={view === 'orders' ? 'page' : undefined} onclick={() => (view = 'orders')} data-nav="orders">{t.nav.orders}</button>
      {/if}
      {#if owner}
        <button type="button" aria-current={view === 'forms' ? 'page' : undefined} onclick={() => ((formAsked = ''), (view = 'forms'))} data-nav="forms">{t.nav.forms}</button>
        <button type="button" aria-current={view === 'messages' ? 'page' : undefined} onclick={() => (view = 'messages')} data-nav="messages">{t.nav.messages}</button>
        <button type="button" onclick={() => panel('site')} data-nav="settings">{t.nav.settings}</button>
        <button type="button" onclick={() => panel('theme')} data-nav="theme">{t.nav.theme}</button>
        <button type="button" aria-current={view === 'layouts' ? 'page' : undefined} onclick={() => (view = 'layouts')} data-nav="layouts">{t.nav.layouts}</button>
        <button type="button" aria-current={view === 'types' ? 'page' : undefined} onclick={() => (view = 'types')} data-nav="types">{t.ctypes.heading}</button>
        <button type="button" aria-current={view === 'import' ? 'page' : undefined} onclick={() => (view = 'import')} data-nav="import">{t.nav.import}</button>
        <button type="button" aria-current={view === 'export' ? 'page' : undefined} onclick={() => (view = 'export')} data-nav="export">{t.nav.export}</button>
        <button type="button" aria-current={view === 'extensions' || view.startsWith('ext:') ? 'page' : undefined} onclick={() => (view = 'extensions')} data-nav="extensions">{t.ext.heading}</button>
        <button type="button" aria-current={view === 'backups' ? 'page' : undefined} onclick={() => (view = 'backups')} data-nav="backups">{t.nav.backups}</button>
        {#if site.accounts}
          <button type="button" aria-current={view === 'people' ? 'page' : undefined} onclick={() => (view = 'people')} data-nav="people">{t.nav.people}</button>
        {/if}
      {/if}
      {#if site.accounts}
        <button type="button" aria-current={view === 'me' ? 'page' : undefined} onclick={() => (view = 'me')} data-nav="me">{t.nav.me}</button>
        <span class="grow"></span>
        <small class="me">{site.me.name || site.me.email}</small>
        <button type="button" onclick={signOut} data-sign-out>{t.door.signOut}</button>
      {/if}
    </nav>

    {#if view === 'pages'}
      <div class="stack">
        <ContentList kind="page" items={site.pages} site={site.site} onopen={(slug) => edit(slug, 'page')} layouts={site.site.layouts ?? READY_LAYOUTS} oncreate={(title, layout) => createPage(title, 'page', layout)} ontranslate={translatePage} />
        <SiteCheck />
      </div>
    {:else if view === 'sections'}
      <Sections sections={site.sections} site={site.site} onopen={(slug) => edit(slug, SECTION_KIND)} oncreate={(title) => createPage(title, SECTION_KIND)} ontranslate={(slug, language) => translatePage(slug, language, SECTION_KIND)} />
    {:else if view === 'layouts'}
      <Layouts site={site.site} sections={site.sections} onsave={saveLayouts} />
    {:else if view === 'types'}
      <ContentTypes site={site.site} shop={site.shop.on} counts={Object.fromEntries(types.map((ty) => [ty.id, site?.entries[ty.id]?.length ?? 0]))} templates={site.templates} terms={Object.fromEntries(types.map((ty) => [ty.id, [...new Set((site?.entries[ty.id] ?? []).flatMap((e) => e.terms ?? []))]]))} onsave={saveTypes} ondesign={(id) => edit(id, `template:${id}`)} />
    {:else if view.startsWith('list:')}
      {@const listed = types.find((ty) => `list:${ty.id}` === view)}
      {#if listed}
        {#key listed.id}
          <ContentList kind={listed.id} type={listed} items={listedOf(listed.id)} people={site.people} site={site.site} onopen={(slug) => edit(slug, listed.id)} oncreate={(title) => createPage(title, listed.id)} ontranslate={(slug, language) => translatePage(slug, language, listed.id)} />
        {/key}
      {/if}
    {:else if view === 'media'}
      <MediaLibrary />
    {:else if view === 'forms'}
      {#key formAsked}<Forms site={site.site} open={formAsked} onchange={(forms) => site && (site = { ...site, forms: forms.map((f) => ({ name: f.name, title: f.title })) })} />{/key}
    {:else if view === 'messages'}
      <Messages />
    {:else if view === 'orders'}
      <Orders />
    {:else if view === 'backups'}
      <Backups />
    {:else if view === 'stats'}
      <Stats onchange={(next) => site && (site = { ...site, extensions: next })} />
    {:else if view === 'comments'}
      <Comments site={site.site} entries={site.entries} />
    {:else if view === 'import'}
      <ImportScreen ondone={reload} />
    {:else if view === 'export'}
      <ExportScreen site={site.site} />
    {:else if view === 'people'}
      <People />
    {:else if view === 'review'}
      <Reviews {types} entries={site.entries} people={site.people} onopen={(slug, of) => edit(slug, of)} />
    {:else if view === 'me'}
      <Profile me={site.me} onsaved={(next) => (site = next)} />
    {:else if view === 'extensions'}
      <Extensions extensions={site.extensions} onchange={(next) => site && (site = { ...site, extensions: next })} onopen={(name, screen) => (view = `ext:${name}/${screen}`)} />
    {:else if view.startsWith('ext:')}
      {@const [name, screen] = view.slice(4).split('/')}
      {@const extension = site.extensions.find((e) => e.name === name)}
      {@const found = extension ? findView(extension.views ?? [], screen ?? '') : null}
      {#if extension && found}
        {#key view}<ExtensionScreen {extension} doc={found.view === found.doc ? found.doc : { ...found.view, spec: found.doc.spec, id: screen ?? '', title: found.view.title ?? found.doc.title }} onnavigate={(id) => (view = `ext:${extension.name}/${id}`)} />{/key}
      {/if}
    {/if}
    {#if failure && view !== 'edit'}<p class="bad toast" role="alert">{failure}</p>{/if}
    {#if site.shared.kind === 'valkey' && !site.shared.up && view !== 'edit'}<p class="bad toast" role="alert" data-valkey-down>{t.performance.warning}</p>{/if}
    {#if site.backupFailed && view !== 'edit' && view !== 'backups'}<p class="bad toast" role="alert" data-backup-failed>{t.backups.warning}</p>{/if}

    <!-- The builder stays in the page while a list shows, so the canvas is ready when a page is chosen. -->
    <div class="builder" hidden={view !== 'edit'}>
    <header class="bar">
      <button type="button" class="quiet" onclick={() => (view = home)} data-back>← {designed ? t.ctypes.heading : type ? type.name : t.nav.pages}</button>
      <strong class="doc">{page.title}</strong>
      <button type="button" onclick={undo} disabled={past.length === 0} title={t.bar.undo} aria-label={t.bar.undo}>↶</button>
      <button type="button" onclick={redo} disabled={future.length === 0} title={t.bar.redo} aria-label={t.bar.redo}>↷</button>
      <span class="devices" role="group" aria-label={t.bar.device}>
        {#each DEVICES as d (d)}<button type="button" aria-pressed={device === d} onclick={() => (device = d)} data-device={d}>{t.bar[d]}</button>{/each}
      </span>
      <span class="status" data-state={saving} role="status">{failure && saving === 'error' ? `${t.bar.error}: ${failure}` : t.bar[saving]}</span>
      <span class="grow"></span>
      {#if owner}
      <button type="button" onclick={toggleSite} aria-pressed={siteMode} data-site-mode>{siteMode ? t.theme.done : t.site.edit}</button>
      <label class="inline">
        <span>{t.bar.theme}</span>
        <select value={site.theme.name} onchange={(e) => chooseTheme(e.currentTarget.value)} data-theme>
          {#if !site.themes.some((th) => th.name === site?.theme.name)}<option value={site.theme.name}>{site.theme.name}</option>{/if}
          {#each site.themes as theme}<option value={theme.name}>{theme.name}</option>{/each}
        </select>
      </label>
      <button type="button" onclick={toggleTheme} aria-pressed={themeMode} data-theme-mode>{themeMode ? t.theme.done : t.theme.edit}</button>
      {#if site.themeChanged}<button type="button" onclick={publishTheme} title={t.theme.changed} data-publish-theme>{t.theme.publish}</button>{/if}
      {/if}
      {#if publicPath && info?.published}<a class="out" href={publicPath} target="_blank" rel="noopener" title={t.bar.viewPageHint} data-view-page>{t.bar.viewPage} ↗</a>{/if}
      <span class="sep"></span>
      <span class="state" data-review-state={review?.state ?? ''}>{review ? (review.state === 'waiting' ? t.review.waiting : t.review.returned) : !info?.published ? t.bar.draft : info.changed || saving !== 'saved' ? t.bar.changed : t.bar.published}</span>
      {#if contributor}
        <button type="button" class="primary" onclick={askReview} disabled={!type || info?.published || (review?.state === 'waiting' && saving === 'saved')} data-ask-review>{t.review.send}</button>
      {:else}
        <button type="button" class="primary" onclick={publish} disabled={info?.published && !info.changed && saving === 'saved'}>{t.bar.publish}</button>
      {/if}
    </header>

    <aside class="left">
      <h2>{t.app.blocks}</h2>
      <input type="search" class="find" placeholder={t.app.blockSearch} aria-label={t.app.blockSearch} bind:value={blockQuery} data-block-search />
      {#each blockGroups as group (group.id)}
        <details class="blocks" open data-block-group={group.id}>
          <summary>{t.blockGroups[group.id] ?? group.id}</summary>
          <ul class="library">
            {#each group.types as type (type)}
              <li>
                <button
                  type="button"
                  draggable="true"
                  title={t.blockHints[type] ?? ''}
                  ondragstart={(e) => {
                    e.dataTransfer?.setData('application/x-uhlaka-type', type);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onclick={() => add(type)}
                  data-add={type}>{t.blockNames[type] ?? t.types[type] ?? type}</button>
              </li>
            {/each}
            {#each group.extensions as one (one.id)}
              <li>
                <button
                  type="button"
                  draggable="true"
                  title={one.label}
                  ondragstart={(e) => {
                    e.dataTransfer?.setData('application/x-uhlaka-type', `extension:${one.id}`);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onclick={() => add('extension', { block: one.id })}
                  data-add-extension={one.id}>{one.label}</button>
              </li>
            {/each}
          </ul>
        </details>
      {:else}
        <p class="hint" data-no-block>{t.app.noBlock}</p>
      {/each}
      <p class="hint">{t.app.blocksHint}</p>
    </aside>

    <main class="canvas">
      <iframe bind:this={frame} src="/preview" title={page.title} style:max-width={WIDTHS[device]} data-showing={device}></iframe>
    </main>

    <aside class="right">
      {#if siteMode}
        <h2>{t.site.heading}</h2>
        <SitePanel site={site.site} pages={pagesIn(site.site, site.site.language, site.pages)} lists={menuLists} languages={site.languages} onchange={editSite} onadminlanguage={setAdminLanguage} shop={site.shop} onshop={reload} />
      {:else if themeMode}
        <h2>{t.theme.heading}</h2>
        <ThemeBuilder theme={site.theme} onchange={editTheme} />
      {:else if block && def}
        <h2>{t.types[block.type] ?? block.type}</h2>
        <div class="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'content'} onclick={() => (tab = 'content')}>{t.inspector.content}</button>
          <button type="button" role="tab" aria-selected={tab === 'style'} onclick={() => (tab = 'style')}>{t.inspector.style}</button>
        </div>
        {#if tab === 'content'}
          {#key block.id}
            <Fields
              fields={def.fields}
              content={block.content}
              sources={types}
              sections={site.sections.filter((one) => !sectioning || one.slug !== page?.slug)}
              forms={site.forms}
              blocks={extensionBlocks}
              onform={owner ? openForm : undefined}
              {parts}
              onchange={(path, value) => patch(block.id, (b) => ({ ...b, content: setPath(b.content, path, value) }))}
            />
          {/key}
          <ExtensionTools extensions={site.extensions} on="block" languages={siteLanguages} onrun={runOnBlock} />
        {:else}
          {#key block.id}
            <StylePanel
              {block}
              theme={site.theme}
              onstyle={(style: BlockStyle) =>
                patch(block.id, (b) => {
                  const { style: _old, ...rest } = b;
                  return Object.keys(style).length ? { ...rest, style } : rest;
                })}
              onvariant={(variant) =>
                patch(block.id, (b) => {
                  const { variant: _old, ...rest } = b;
                  return variant ? { ...rest, variant } : rest;
                })}
            />
          {/key}
        {/if}
      {:else if designed}
        <h2>{say(t.design.heading, { singular: designed.singular.toLowerCase() })}</h2>
        <p class="hint">{say(t.design.intro, { name: designed.name })}</p>
        {#if site.templates[designed.id]?.custom}
          <button type="button" class="danger" onclick={removePage} data-design-reset>{t.design.reset}</button>
          <small>{t.design.resetHint}</small>
        {/if}
      {:else}
        <h2>{type ? type.singular : sectioning ? t.sections.one : t.inspector.page}</h2>
        <label class="field">
          <span>{t.inspector.title}</span>
          <input type="text" maxlength="200" value={page.title} oninput={(e) => page && e.currentTarget.value.trim() && change({ ...page, title: e.currentTarget.value }, { step: false })} />
        </label>
        <label class="field">
          <span>{t.inspector.description}</span>
          <textarea rows="3" maxlength="300" value={page.description} placeholder={type && 'date' in page ? postDescription({ ...page, description: '' }) : pageDescription({ ...(page as Page), description: '' })} data-description oninput={(e) => page && change({ ...page, description: e.currentTarget.value }, { step: false, redraw: false })}></textarea>
          <small>{t.inspector.descriptionHint}</small>
        </label>
        {#if !sectioning}
          {@const entry = type && 'date' in page ? page : null}
          <SeoPanel
            seo={page}
            title={page.slug || entry ? `${page.title} · ${site.site.name}` : site.site.name}
            description={entry ? postDescription(entry) : pageDescription(page as Page)}
            address={`${site.site.url || ''}${type && entry ? (translation ? entryPath(typeIn(site.site, type, translation.language), page.slug.slice(prefixOf(translation.language).length + 1)) : entryPath(type, page.slug)) : pagePath(page.slug)}`}
            fallback={entry?.cover ?? site.site.shareImage ?? null}
            translation={!!translation}
            onchange={(seo) => page && change({ ...page, ...seo }, { step: false, redraw: false })}
          />
        {/if}
        {#if type && 'date' in page && translation}
          {@const post = page}
          {@const within = translation}
          {@const languageLabel = languageName(within.language)}
          <label class="field">
            <span>{say(t.inspector.address, { language: languageLabel })}</span>
            <input
              type="text"
              value={post.slug.slice(prefixOf(within.language).length + 1)}
              onchange={(e) => site && change({ ...post, slug: slugIn(site.site, within.language, slugify(e.currentTarget.value) || within.of) }, { step: false, redraw: false })}
              data-translation-address
            />
          </label>
          <label class="field">
            <span>{t.posts.excerpt}</span>
            <textarea rows="3" maxlength="400" value={post.excerpt} oninput={(e) => change({ ...post, excerpt: e.currentTarget.value }, { step: false, redraw: false })} data-post-excerpt></textarea>
          </label>
          {#if post.cover}
            {@const cover = post.cover}
            <label class="field">
              <span>{say(t.ctypes.coverAlt, { language: languageLabel })}</span>
              <input type="text" maxlength="300" value={cover.alt} onchange={(e) => change({ ...post, cover: { ...cover, alt: e.currentTarget.value } }, { step: false })} data-cover-alt />
            </label>
          {/if}
          {#each type.fields.filter((f) => f.kind === 'text' || f.kind === 'longtext') as field (field.key)}
            <label class="field">
              <span>{field.label}</span>
              {#if field.kind === 'longtext'}
                <textarea rows="3" maxlength="2000" value={String(post.fields[field.key] ?? '')} onchange={(e) => change({ ...post, fields: { ...post.fields, [field.key]: e.currentTarget.value } }, { step: false })} data-entry-field={field.key}></textarea>
              {:else}
                <input type="text" maxlength="300" value={String(post.fields[field.key] ?? '')} onchange={(e) => change({ ...post, fields: { ...post.fields, [field.key]: e.currentTarget.value } }, { step: false })} data-entry-field={field.key} />
              {/if}
            </label>
          {/each}
          {#if within.split}
            <p class="hint" data-split-note>{say(t.ctypes.splitEntryNote, { language: languageLabel })}</p>
          {:else}
            <p class="hint">{t.ctypes.translationNote}</p>
            <button type="button" onclick={splitPage} data-split>{say(t.ctypes.splitEntry, { language: languageLabel })}</button>
            <small>{t.ctypes.splitEntryHint}</small>
          {/if}
        {:else if type && 'date' in page}
          {@const post = page}
          {#if type.dated}
          <label class="field">
            <span>{t.posts.date}</span>
            <input type="date" value={post.date} onchange={(e) => e.currentTarget.value && change({ ...post, date: e.currentTarget.value }, { step: false })} data-post-date />
          </label>
          {/if}
          {#if type.categories}
          <label class="field">
            <span>{t.posts.categories}</span>
            <input
              type="text"
              value={post.categories.join(', ')}
              onchange={(e) => change({ ...post, categories: e.currentTarget.value.split(',').map((c) => c.trim()).filter(Boolean) }, { step: false })}
              data-post-categories
            />
            <small>{t.posts.categoriesHint}</small>
          </label>
          <label class="field">
            <span>{t.posts.tags}</span>
            <input
              type="text"
              value={post.tags.join(', ')}
              onchange={(e) => change({ ...post, tags: e.currentTarget.value.split(',').map((c) => c.trim()).filter(Boolean) }, { step: false })}
              data-post-tags
            />
            <small>{t.posts.tagsHint}</small>
          </label>
          {/if}
          <label class="field">
            <span>{t.posts.excerpt}</span>
            <textarea rows="3" maxlength="400" value={post.excerpt} oninput={(e) => change({ ...post, excerpt: e.currentTarget.value }, { step: false, redraw: false })} data-post-excerpt></textarea>
            <small>{t.posts.excerptHint}</small>
          </label>
          <div class="field">
            <ImageField label={t.posts.cover} value={post.cover} onchange={(cover) => change({ ...post, cover: cover.src ? cover : null }, { step: false })} />
          </div>
          <EntryFieldsForm {type} {types} entries={site.entries} own={post.slug} values={post.fields} onchange={(fields) => change({ ...post, fields }, { step: false })} />
          {#if type.sells && site.shop.on}
            <ProductForm product={post.product} shop={site.shop} kind={type.id} slug={post.slug} onchange={(product) => change({ ...post, product }, { step: false })} />
          {/if}
          {@const entry = info as PostInfo | undefined}
          {#if staff && site.accounts}
            <label class="field">
              <span>{t.review.author}</span>
              <select value={entry?.author ?? ''} onchange={(e) => setAuthor(e.currentTarget.value)} data-entry-author>
                <option value="">{t.review.nobody}</option>
                {#each site.people as person (person.id)}<option value={person.id}>{person.name}</option>{/each}
              </select>
            </label>
          {/if}
          {#if staff && entry?.review?.state === 'waiting'}
            <label class="field">
              <span>{t.review.note}</span>
              <textarea rows="3" maxlength="500" bind:value={returnNote} data-review-note></textarea>
            </label>
            <button type="button" onclick={() => returnReview(returnNote).then(() => (returnNote = ''))} data-review-back>{t.review.back}</button>
          {/if}
          {#if contributor && entry?.review?.state === 'returned'}
            <p class="hint" data-review-returned>{say(t.review.returnedNote, { note: entry.review.note })}</p>
          {:else if contributor && entry?.review?.state === 'waiting'}
            <p class="hint">{t.review.sent}</p>
          {:else if contributor && entry?.published}
            <p class="hint" data-review-published>{t.review.published}</p>
          {/if}
        {:else if 'inMenu' in page && translation}
          {@const within = translation}
          {@const languageLabel = languageName(within.language)}
          {#if !sectioning}
          <label class="field">
            <span>{say(t.inspector.address, { language: languageLabel })}</span>
            <input
              type="text"
              value={page.slug.slice(prefixOf(within.language).length + 1)}
              disabled={within.of === ''}
              onchange={(e) => page && site && change({ ...page, slug: slugIn(site.site, within.language, slugify(e.currentTarget.value) || within.of) }, { step: false, redraw: false })}
              data-translation-address
            />
          </label>
          {/if}
          {#if within.split}
            <p class="hint" data-split-note>{say(t.inspector.splitNote, { language: languageLabel })}</p>
          {:else}
            <p class="hint">{t.inspector.translationNote}</p>
            <button type="button" onclick={splitPage} data-split>{say(t.inspector.split, { language: languageLabel })}</button>
            <small>{t.inspector.splitHint}</small>
          {/if}
        {:else if sectioning}
          {@const info = site.sections.find((one) => one.slug === page?.slug)}
          <p class="hint" data-section-used>{t.sections.usedOn}: {info?.usedOn.length ? info.usedOn.join(', ') : t.sections.unused}</p>
        {:else if 'inMenu' in page}
          {#if kind === 'page' && page.slug !== ''}
            <label class="field">
              <span>{t.inspector.pageAddress}</span>
              <input type="text" value={page.slug} onchange={(e) => movePage(e.currentTarget)} data-page-address />
              <small>{t.inspector.pageAddressHint}</small>
            </label>
          {/if}
          <label class="check" class:off={site.site.menu !== null} title={site.site.menu !== null ? t.inspector.inMenuOff : undefined}>
            <input type="checkbox" disabled={site.site.menu !== null} checked={page.inMenu} onchange={(e) => page && 'inMenu' in page && change({ ...page, inMenu: e.currentTarget.checked }, { step: false })} />
            <span>{t.inspector.inMenu}</span>
          </label>
          <label class="field">
            <span>{t.layouts.pick}</span>
            <select value={page.layout ?? STANDARD} onchange={(e) => page && 'inMenu' in page && change({ ...page, layout: e.currentTarget.value === STANDARD ? undefined : e.currentTarget.value })} data-page-layout>
              {#each site.site.layouts ?? READY_LAYOUTS as layout (layout.id)}<option value={layout.id}>{layoutName(layout)}</option>{/each}
            </select>
          </label>
        {/if}
        {#if freeOnPage > 0}
          <p class="hint">{say(t.style.free, { count: freeOnPage })}</p>
          <button type="button" onclick={() => page && setBlocks(resetToTheme(page.blocks))}>{t.style.resetPage}</button>
        {/if}
        <p class="hint">{t.inspector.nothing}</p>
        <ExtensionTools extensions={site.extensions} on="page" languages={siteLanguages} onrun={runOnPage} oneach={everyLanguage && staff ? runEveryLanguage : undefined} />
        {#if !designing && !sectioning && !translation && !contributor}
          {#key `${kind}/${page.slug}`}<Schedule slug={page.slug} {kind} />{/key}
          {#if kind === 'page' && page.slug !== ''}{#key page.slug}<PageLock slug={page.slug} />{/key}{/if}
          {#if type || page.slug !== ''}{#key `${kind}/${page.slug}`}<Audience kind={type ? 'entry' : 'page'} key={type ? `${kind}/${page.slug}` : page.slug} />{/key}{/if}
        {/if}
        {#if !designing && !(type && translation)}
          {#key `${kind}/${page.slug}`}<Versions slug={page.slug} {kind} onrestore={(doc) => change(doc)} />{/key}
        {/if}
        {#if (type || page.slug !== '') && !(contributor && info?.published)}
          {#if usedBy.length}<p class="hint" data-used-by>{say(t.ctypes.usedBy, { count: usedBy.length, titles: usedBy.join(', ') })}</p>{/if}
          <button type="button" class="danger" onclick={removePage}>{translation ? say(t.inspector.deleteTranslation, { language: languageName(translation.language) }) : sectioning ? t.sections.delete : !type ? t.inspector.deletePage : kind === POSTS_TYPE ? t.posts.deletePost : t.ctypes.deleteEntry}</button>
        {/if}
      {/if}
      {#if failure && saving !== 'error'}<p class="bad" role="alert">{failure}</p>{/if}
    </aside>
    </div>
  </div>
{/if}

<style>
  :global(html, body) { height: 100%; margin: 0; }
  :global(body) { font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1c1b22; background: #f3f2f7; }
  :global(*) { box-sizing: border-box; }
  .notice { margin: 4rem auto; max-width: 30rem; text-align: center; }
  .admin { display: grid; height: 100vh; grid-template-columns: 11rem 1fr; }
  .admin.building { grid-template-columns: 1fr; }
  .rail[hidden] { display: none; }
  .rail { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.9rem 0.6rem; background: #1c1b22; color: #fff; }
  .rail .me { padding: 0 0.5rem; color: #a9a6bd; overflow-wrap: anywhere; }
  .rail .site { display: grid; gap: 0.1rem; padding: 0.3rem 0.5rem 0.5rem; margin-bottom: 0.4rem; border-radius: 6px; color: #fff; text-decoration: none; overflow-wrap: anywhere; }
  .rail .site small { color: #a9a6bd; }
  .rail .site:hover { background: #2e2c3a; }
  .rail .site:hover small { color: #fff; text-decoration: underline; }
  .out { padding: 0.4rem 0.7rem; border: 1px solid #cfccdc; border-radius: 6px; color: inherit; text-decoration: none; white-space: nowrap; }
  .out:hover { border-color: #6d5dfc; }
  :global(.editor .rail button) { border-color: transparent; background: none; color: #d9d7e6; text-align: start; }
  :global(.editor .rail button:hover:not(:disabled):not([aria-current='page'])) { border-color: transparent; background: #2e2c3a; }
  :global(.editor .rail button[aria-current='page']) { background: #6d5dfc; color: #fff; font-weight: 600; }
  :global(.editor .screen) { overflow-y: auto; padding: 1.5rem 2rem; }
  .stack { min-width: 0; overflow-y: auto; }
  .stack > :global(.screen) { overflow-y: visible; }
  .toast { position: fixed; inset-block-end: 1rem; inset-inline-end: 1rem; padding: 0.5rem 0.8rem; background: #fff; border: 1px solid #b3261e; border-radius: 6px; }
  .builder { display: grid; min-width: 0; height: 100vh; grid-template: 'bar bar bar' auto 'left canvas right' 1fr / 14rem 1fr 19rem; }
  .builder[hidden] { display: none; }
  .doc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 16rem; }
  .bar { grid-area: bar; display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.9rem; background: #fff; border-bottom: 1px solid #dddbe6; }
  .grow { flex: 1; }
  .sep { width: 1px; align-self: stretch; background: #dddbe6; }
  .status, .state { color: #6a6880; font-size: 13px; }
  .status[data-state='error'] { color: #b3261e; }
  .left, .right { overflow-y: auto; padding: 0.9rem; background: #fff; }
  .left { grid-area: left; border-right: 1px solid #dddbe6; }
  .right { grid-area: right; border-left: 1px solid #dddbe6; }
  .canvas { grid-area: canvas; padding: 0.9rem; min-width: 0; }
  .canvas { display: grid; justify-items: center; }
  iframe { width: 100%; height: 100%; border: 1px solid #dddbe6; border-radius: 8px; background: #fff; transition: max-width 0.2s; }
  .devices { display: inline-flex; }
  .devices button { border-radius: 0; margin-inline-start: -1px; font-size: 0.85rem; padding: 0.3rem 0.55rem; }
  .devices button:first-child { border-start-start-radius: 6px; border-end-start-radius: 6px; }
  .devices button:last-child { border-start-end-radius: 6px; border-end-end-radius: 6px; }
  .devices button[aria-pressed='true'] { background: #f0eeff; border-color: #6d5dfc; position: relative; }
  h2 { margin: 1.1rem 0 0.5rem; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #6a6880; }
  h2:first-child { margin-top: 0; }
  ul { list-style: none; margin: 0 0 0.6rem; padding: 0; display: grid; gap: 0.25rem; }
  .library { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .find { width: 100%; margin-bottom: 0.6rem; padding: 0.4rem 0.5rem; border: 1px solid #cfccdc; border-radius: 6px; background: #fff; color: inherit; font: inherit; }
  .blocks { margin-bottom: 0.4rem; }
  .blocks summary { cursor: pointer; padding: 0.25rem 0; font-size: 12.5px; font-weight: 600; color: #4b4960; }
  .blocks .library { margin-top: 0.3rem; }
  :global(.editor button) { padding: 0.4rem 0.7rem; border: 1px solid #cfccdc; border-radius: 6px; background: #fff; color: inherit; font: inherit; cursor: pointer; }
  :global(.editor button:hover:not(:disabled)) { border-color: #6d5dfc; }
  :global(.editor button:disabled) { opacity: 0.45; cursor: default; }
  :global(.editor button.primary) { background: #6d5dfc; border-color: #6d5dfc; color: #fff; font-weight: 600; }
  :global(.editor button.quiet) { border-color: transparent; color: #6a6880; }
  :global(.editor button.danger) { color: #b3261e; margin-top: 1rem; }
  .library button { width: 100%; height: 100%; padding-inline: 0.5rem; text-align: start; font-size: 13px; line-height: 1.25; }
  .tabs { display: flex; gap: 0.25rem; margin-bottom: 0.8rem; }
  .tabs button { flex: 1; }
  .tabs button[aria-selected='true'] { background: #f1efff; border-color: #6d5dfc; font-weight: 600; }
  :global(.editor .field) { display: block; margin-bottom: 0.7rem; }
  :global(.editor label > span, .editor legend) { display: block; margin-bottom: 0.2rem; font-size: 12.5px; color: #4b4960; }
  :global(.editor input[type='text'], .editor input[type='email'], .editor input[type='password'], .editor input[type='number'], .editor input[type='url'], .editor input[type='date'], .editor textarea, .editor select) { width: 100%; padding: 0.4rem 0.5rem; border: 1px solid #cfccdc; border-radius: 6px; background: #fff; color: inherit; font: inherit; }
  :global(.editor input[aria-invalid='true']) { border-color: #b3261e; }
  :global(.editor textarea) { resize: vertical; }
  :global(.editor fieldset) { margin: 0; padding: 0.6rem; border: 1px solid #e4e2ee; border-radius: 6px; }
  :global(.editor fieldset label) { display: block; margin-bottom: 0.5rem; }
  :global(.editor .item) { padding-bottom: 0.5rem; margin-bottom: 0.6rem; border-bottom: 1px dashed #dddbe6; }
  :global(.editor .hint, .editor small) { display: block; color: #6a6880; font-size: 12.5px; }
  :global(.editor .bad) { color: #b3261e; font-size: 12.5px; }
  :global(.editor .own) { color: #c77700; font-style: normal; margin-inline-start: 0.3rem; }
  :global(.editor .custom) { display: flex; gap: 0.3rem; margin-top: 0.3rem; }
  :global(.editor .custom input[type='color']) { width: 2.4rem; padding: 0; border: 1px solid #cfccdc; border-radius: 6px; background: none; }
  .inline { display: flex; align-items: center; gap: 0.4rem; }
  .inline span { margin: 0; }
  .inline select { width: auto; }
  .check { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.8rem; }
  .check span { margin: 0; }
  .check.off { opacity: 0.55; }
</style>
