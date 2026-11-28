<script lang="ts">
/**
 * The header, whole (ADR 0082 d3): what it says (the logo, the menu, the
 * button) and how it looks (stays at the top, arrangement, colours). What it
 * says is kept with the site, how it looks with its style; this is only where
 * both are edited, opened by a click on the header.
 */
import { onMount } from 'svelte';
import { type BlockStyle, HEADER_ARRANGEMENTS, languageName, type LinkValue, type MenuList, type Site, type SiteText, type Theme } from '../core/index.ts';
import { api, type PageInfo } from './api.ts';
import ImageField from './ImageField.svelte';
import MenuBuilder from './MenuBuilder.svelte';
import { say, t } from './messages.ts';
import StyleEditor from './StyleEditor.svelte';
import { tryTheme } from './themeEdit.ts';

let {
  site,
  theme,
  pages,
  lists,
  onsite,
  ontheme,
}: {
  site: Site;
  theme: Theme;
  pages: PageInfo[];
  lists: MenuList[];
  onsite: (site: Site) => void;
  ontheme: (theme: Theme) => void;
} = $props();

const set = (patch: Partial<Site>): void => onsite({ ...site, ...patch });
const link = (value: LinkValue | null, patch: Partial<LinkValue>): LinkValue => ({ label: value?.label ?? '', href: value?.href ?? '', ...patch });
const own = (language: string): SiteText => site.translations[language] ?? { footer: '', action: null, footerLinks: [] };
const setOwn = (language: string, patch: Partial<SiteText>): void => set({ translations: { ...site.translations, [language]: { ...own(language), ...patch } } });

let problem = $state('');
function apply(mutate: (draft: Theme) => void): void {
  const tried = tryTheme(theme, mutate, t.style.invalid);
  problem = tried.problem;
  if (tried.theme) ontheme(tried.theme);
}
const setStyle = (part: 'header' | 'menu', style: BlockStyle): void =>
  apply((d) => {
    if (Object.keys(style).length) d.layout[part].style = style;
    else delete d.layout[part].style;
  });

/** Whether visitor accounts are on: the menu may then lead to "My account" (ADR 0064 d4, d8). */
let accounts = $state(false);
onMount(() => {
  api.visitors().then((shown) => (accounts = shown.settings.on)).catch(() => {});
});
</script>

<p class="hint">{t.look.headerIntro}</p>
{#if problem}<p class="bad problem" role="alert">{problem}</p>{/if}

<label class="switch" data-header-sticky>
  <input type="checkbox" role="switch" checked={theme.layout.header.sticky} onchange={(e) => apply((d) => { d.layout.header.sticky = e.currentTarget.checked; })} data-layout-sticky />
  <span><strong>{t.layout.sticky}</strong><small>{t.layout.stickyHint}</small></span>
</label>

<h3>{t.look.says}</h3>
<div class="field">
  <ImageField label={t.site.logo} value={site.logo} named={false} onchange={(logo) => set({ logo: logo.src ? logo : null })} />
  <small>{t.site.logoHint}</small>
</div>

<div class="field" data-menu-builder>
  <span class="label">{t.menu.title}</span>
  <MenuBuilder {site} {pages} {lists} {accounts} nodes={site.menu} onchange={(menu) => set({ menu })} />
</div>

<fieldset class="field" data-site-action>
  <legend>{t.site.action}</legend>
  <label><span>{t.inspector.linkLabel}</span>
    <input type="text" maxlength="80" value={site.action?.label ?? ''} oninput={(e) => set({ action: link(site.action, { label: e.currentTarget.value }) })} />
  </label>
  <label><span>{t.inspector.linkHref}</span>
    <input type="text" value={site.action?.href ?? ''} oninput={(e) => set({ action: link(site.action, { href: e.currentTarget.value }) })} />
  </label>
</fieldset>

{#each site.languages as language (language)}
  <fieldset class="field" data-own-action={language}>
    <legend>{say(t.look.actionIn, { language: languageName(language) })}</legend>
    <label><span>{t.inspector.linkLabel}</span>
      <input type="text" maxlength="80" value={own(language).action?.label ?? ''} oninput={(e) => setOwn(language, { action: link(own(language).action, { label: e.currentTarget.value }) })} />
    </label>
    <label><span>{t.inspector.linkHref}</span>
      <input type="text" value={own(language).action?.href ?? ''} oninput={(e) => setOwn(language, { action: link(own(language).action, { href: e.currentTarget.value }) })} />
    </label>
    <small>{t.site.inLanguageHint}</small>
  </fieldset>
{/each}

<h3>{t.look.looks}</h3>
<fieldset class="field arrangements" data-layout="header">
  <legend>{t.layout.arrangement}</legend>
  <div class="choices">
    {#each HEADER_ARRANGEMENTS as name (name)}
      <label class="choice" class:on={theme.layout.header.arrangement === name}>
        <input type="radio" name="header-arrangement" value={name} checked={theme.layout.header.arrangement === name} onchange={() => apply((d) => { d.layout.header.arrangement = name; })} data-layout-header={name} />
        <span class="pic {name}" aria-hidden="true"><i class="logo"></i><i class="nav"></i><i class="nav"></i><i class="nav"></i></span>
        <span>{t.layout.arrangements[name] ?? name}</span>
      </label>
    {/each}
  </div>
</fieldset>

<details>
  <summary>{t.look.headerColours}</summary>
  <div data-layout-style="header">
    <StyleEditor style={theme.layout.header.style} {theme} onstyle={(style) => setStyle('header', style)} defaultLabel={t.theme.unset} />
  </div>
</details>
<details>
  <summary>{t.menu.panel}</summary>
  <p class="hint">{t.look.menuPanelHint}</p>
  <div data-layout-style="menu">
    <StyleEditor style={theme.layout.menu.style} {theme} onstyle={(style) => setStyle('menu', style)} defaultLabel={t.theme.unset} />
  </div>
</details>

<style>
  h3 { margin: 1.2rem 0 0.5rem; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #5b4cdb; }
  .label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 0.3rem; }
  .problem { position: sticky; top: -0.9rem; z-index: 1; margin: 0 -0.9rem 0.6rem; padding: 0.5rem 0.9rem; background: #fdecea; }
  .switch { display: flex; gap: 0.7rem; align-items: flex-start; padding: 0.7rem; border: 1px solid #dddbe6; border-radius: 10px; background: #fff; cursor: pointer; }
  .switch strong { display: block; font-size: 13px; }
  .switch small { display: block; color: #6a6880; margin-top: 0.15rem; }
  .switch input { appearance: none; flex: none; width: 34px; height: 20px; margin: 0; border-radius: 99px; background: #cfcde0; position: relative; cursor: pointer; transition: background 0.15s; }
  .switch input::after { content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
  .switch input:checked { background: #5b4cdb; }
  .switch input:checked::after { transform: translateX(14px); }
  .switch input:focus-visible { outline: 2px solid #5b4cdb; outline-offset: 2px; }
  .choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.4rem; }
  .choice { display: grid; gap: 0.3rem; justify-items: center; padding: 0.45rem 0.3rem; border: 1px solid #dddbe6; border-radius: 8px; font-size: 12px; text-align: center; cursor: pointer; background: #fff; }
  .choice.on { border: 2px solid #5b4cdb; padding: calc(0.45rem - 1px) calc(0.3rem - 1px); }
  .choice input { position: absolute; opacity: 0; pointer-events: none; }
  .choice:has(input:focus-visible) { outline: 2px solid #5b4cdb; outline-offset: 2px; }
  .pic { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; width: 100%; max-width: 72px; height: 30px; padding: 4px; border-radius: 4px; background: #f2f1f7; }
  .pic i { display: block; height: 5px; border-radius: 2px; background: #b9b5d6; }
  .pic .logo { width: 18px; background: #5b4cdb; }
  .pic .nav { width: 9px; }
  .pic.inline .logo { margin-inline-end: auto; }
  .pic.centered, .pic.stacked { justify-content: center; }
  .pic.centered .logo, .pic.stacked .logo { flex-basis: 100%; max-width: 18px; margin: 0 calc(50% - 9px); }
  .pic.stacked { align-content: center; }
  .pic.stacked .logo { width: 24px; max-width: 24px; margin: 0 calc(50% - 12px); }
  details { margin: 0.6rem 0; border: 1px solid #e4e2ee; border-radius: 6px; padding: 0.5rem 0.6rem; }
  summary { cursor: pointer; font-weight: 600; }
  details[open] > summary { margin-bottom: 0.6rem; }
</style>
