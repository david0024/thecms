<script lang="ts">
/**
 * What the site says about itself on every page: its name or logo, the button
 * in the header, the footer's words and links. How these are laid out is the
 * theme's (ADR 0006), so nothing here is a colour or a position.
 */
import { type LinkValue, languageName, MAX_LANGUAGES, type MenuList, prefixOf, type Site, type SiteText } from '../core/index.ts';
import type { LanguageInfo, PageInfo } from './api.ts';
import ImageField from './ImageField.svelte';
import MenuBuilder from './MenuBuilder.svelte';
import { say, t } from './messages.ts';

let {
  site,
  pages,
  lists,
  languages = [],
  onchange,
  onadminlanguage,
}: {
  site: Site;
  pages: PageInfo[];
  lists: MenuList[];
  languages?: LanguageInfo[];
  onchange: (site: Site) => void;
  /** The admin's words are read when it starts, so choosing its language saves and opens it again. */
  onadminlanguage?: (language: string) => void;
} = $props();
const named = (l: LanguageInfo): string => (l.coverage < 1 ? `${l.name} (${say(t.site.partial, { count: Math.floor(l.coverage * 100) })})` : l.name);

const set = (patch: Partial<Site>): void => onchange({ ...site, ...patch });
const link = (value: LinkValue | null, patch: Partial<LinkValue>): LinkValue => ({ label: value?.label ?? '', href: value?.href ?? '', ...patch });
const setFooterLink = (i: number, patch: Partial<LinkValue>): void => set({ footerLinks: site.footerLinks.map((l, j) => (j === i ? link(l, patch) : l)) });
/** What the header and footer say in another language (ADR 0024). */
const own = (language: string): SiteText => site.translations[language] ?? { footer: '', action: null, footerLinks: [] };
const setOwn = (language: string, patch: Partial<SiteText>): void => set({ translations: { ...site.translations, [language]: { ...own(language), ...patch } } });
let adding = $state('');
const addLanguage = (): void => {
  const language = adding.trim();
  if (!language) return;
  set({ languages: [...site.languages, language] });
  adding = '';
};
import Redirects from './Redirects.svelte';
</script>

<label class="field">
  <span>{t.site.name}</span>
  <input type="text" maxlength="120" value={site.name} oninput={(e) => e.currentTarget.value.trim() && set({ name: e.currentTarget.value })} data-site-name />
</label>
<label class="field">
  <span>{t.site.language}</span>
  <input type="text" maxlength="20" value={site.language} list="cms-languages" onchange={(e) => set({ language: e.currentTarget.value.trim() })} data-site-language />
  <datalist id="cms-languages">{#each languages as l (l.language)}<option value={l.language}>{named(l)}</option>{/each}</datalist>
  <small>{t.site.languageHint}</small>
</label>
<fieldset class="field" data-site-languages>
  <legend>{t.site.otherLanguages}</legend>
  {#each site.languages as language (language)}
    <div class="custom" data-site-other={language}>
      <span class="grow">{languageName(language)} <small>/{prefixOf(language)}/</small></span>
      <button type="button" class="quiet" onclick={() => set({ languages: site.languages.filter((l) => l !== language) })} data-language-remove>{t.inspector.remove}</button>
    </div>
  {/each}
  {#if site.languages.length < MAX_LANGUAGES}
    <div class="custom">
      <input type="text" maxlength="20" list="cms-languages" placeholder="ro, de, fr" bind:value={adding} onkeydown={(e) => e.key === 'Enter' && addLanguage()} data-language-new />
      <button type="button" onclick={addLanguage} data-language-add>{t.inspector.add}</button>
    </div>
  {/if}
  <small>{t.site.otherLanguagesHint}</small>
</fieldset>
<label class="field">
  <span>{t.site.adminLanguage}</span>
  <select
    value={site.adminLanguage}
    onchange={(e) => onadminlanguage?.(e.currentTarget.value)}
    data-admin-language
  >
    <option value="">{t.site.sameAsSite}</option>
    {#each languages as l (l.language)}<option value={l.language}>{named(l)}</option>{/each}
  </select>
</label>
<label class="field">
  <span>{t.site.url}</span>
  <input type="url" value={site.url} onchange={(e) => set({ url: e.currentTarget.value.trim() })} />
  <small>{t.site.urlHint}</small>
</label>

<h3>{t.site.header}</h3>
<div class="field">
  <ImageField label={t.site.logo} value={site.logo} onchange={(logo) => set({ logo: logo.src ? logo : null })} />
  <small>{t.site.logoHint}</small>
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

<h3>{t.menu.title}</h3>
<div class="field" data-menu-builder>
  <MenuBuilder {site} {pages} {lists} nodes={site.menu} onchange={(menu) => set({ menu })} />
</div>

<h3>{t.site.footer}</h3>
<label class="field">
  <span>{t.site.footerText}</span>
  <input type="text" maxlength="300" value={site.footer} oninput={(e) => set({ footer: e.currentTarget.value })} data-site-footer />
</label>
<fieldset class="field" data-site-footer-links>
  <legend>{t.site.footerLinks}</legend>
  {#each site.footerLinks as item, i}
    <div class="item">
      <label><span>{t.site.linkText}</span>
        <input type="text" maxlength="80" value={item.label} oninput={(e) => setFooterLink(i, { label: e.currentTarget.value })} />
      </label>
      <label><span>{t.inspector.linkHref}</span>
        <input type="text" value={item.href} oninput={(e) => setFooterLink(i, { href: e.currentTarget.value })} />
      </label>
      <button type="button" class="quiet" onclick={() => set({ footerLinks: site.footerLinks.filter((_, j) => j !== i) })}>{t.inspector.remove}</button>
    </div>
  {/each}
  {#if site.footerLinks.length < 12}
    <button type="button" onclick={() => set({ footerLinks: [...site.footerLinks, { label: '', href: '' }] })}>{t.inspector.add}</button>
  {/if}
</fieldset>
<h3>{t.site.forms}</h3>
<label class="field">
  <span>{t.site.formsAddress}</span>
  <input type="url" value={site.forms} onchange={(e) => set({ forms: e.currentTarget.value.trim() })} data-site-forms />
  <small>{t.site.formsHint}</small>
</label>
<label class="field">
  <span>{t.site.keep}</span>
  <input type="number" min="1" max="3650" value={site.keepMessages} onchange={(e) => set({ keepMessages: Number(e.currentTarget.value) })} data-site-keep />
</label>

{#each site.languages as language (language)}
  <h3>{say(t.site.inLanguage, { language: languageName(language) })}</h3>
  <label class="field">
    <span>{t.site.footerText}</span>
    <input type="text" maxlength="300" value={own(language).footer} oninput={(e) => setOwn(language, { footer: e.currentTarget.value })} data-own-footer={language} />
  </label>
  <fieldset class="field" data-own-action={language}>
    <legend>{t.site.action}</legend>
    <label><span>{t.inspector.linkLabel}</span>
      <input type="text" maxlength="80" value={own(language).action?.label ?? ''} oninput={(e) => setOwn(language, { action: link(own(language).action, { label: e.currentTarget.value }) })} />
    </label>
    <label><span>{t.inspector.linkHref}</span>
      <input type="text" value={own(language).action?.href ?? ''} oninput={(e) => setOwn(language, { action: link(own(language).action, { href: e.currentTarget.value }) })} />
    </label>
  </fieldset>
  <small>{t.site.inLanguageHint}</small>
{/each}

<Redirects />

<p class="hint">{t.site.live}</p>

<style>
  h3 { margin: 1.1rem 0 0.5rem; font-size: 13px; }
  .grow { flex: 1; }
</style>
