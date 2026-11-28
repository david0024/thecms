<script lang="ts">
/**
 * The footer, whole (ADR 0082 d3): its words and links, and how it is laid
 * out and coloured. Opened by a click on the footer.
 */
import { type BlockStyle, FOOTER_ARRANGEMENTS, languageName, type LinkValue, type Site, type SiteText, type Theme } from '../core/index.ts';
import { say, t } from './messages.ts';
import StyleEditor from './StyleEditor.svelte';
import { tryTheme } from './themeEdit.ts';

let {
  site,
  theme,
  onsite,
  ontheme,
}: {
  site: Site;
  theme: Theme;
  onsite: (site: Site) => void;
  ontheme: (theme: Theme) => void;
} = $props();

const set = (patch: Partial<Site>): void => onsite({ ...site, ...patch });
const link = (value: LinkValue | null, patch: Partial<LinkValue>): LinkValue => ({ label: value?.label ?? '', href: value?.href ?? '', ...patch });
const setFooterLink = (i: number, patch: Partial<LinkValue>): void => set({ footerLinks: site.footerLinks.map((l, j) => (j === i ? link(l, patch) : l)) });
const own = (language: string): SiteText => site.translations[language] ?? { footer: '', action: null, footerLinks: [] };
const setOwn = (language: string, patch: Partial<SiteText>): void => set({ translations: { ...site.translations, [language]: { ...own(language), ...patch } } });

let problem = $state('');
function apply(mutate: (draft: Theme) => void): void {
  const tried = tryTheme(theme, mutate, t.style.invalid);
  problem = tried.problem;
  if (tried.theme) ontheme(tried.theme);
}
const setStyle = (style: BlockStyle): void =>
  apply((d) => {
    if (Object.keys(style).length) d.layout.footer.style = style;
    else delete d.layout.footer.style;
  });
</script>

<p class="hint">{t.look.footerIntro}</p>
{#if problem}<p class="bad problem" role="alert">{problem}</p>{/if}

<h3>{t.look.says}</h3>
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

{#each site.languages as language (language)}
  <label class="field">
    <span>{say(t.look.footerIn, { language: languageName(language) })}</span>
    <input type="text" maxlength="300" value={own(language).footer} oninput={(e) => setOwn(language, { footer: e.currentTarget.value })} data-own-footer={language} />
    <small>{t.site.inLanguageHint}</small>
  </label>
{/each}

<h3>{t.look.looks}</h3>
<fieldset class="field arrangements" data-layout="footer">
  <legend>{t.layout.arrangement}</legend>
  <div class="choices">
    {#each FOOTER_ARRANGEMENTS as name (name)}
      <label class="choice" class:on={theme.layout.footer.arrangement === name}>
        <input type="radio" name="footer-arrangement" value={name} checked={theme.layout.footer.arrangement === name} onchange={() => apply((d) => { d.layout.footer.arrangement = name; })} data-layout-footer={name} />
        <span>{t.layout.arrangements[name] ?? name}</span>
      </label>
    {/each}
  </div>
</fieldset>

<details>
  <summary>{t.look.footerColours}</summary>
  <div data-layout-style="footer">
    <StyleEditor style={theme.layout.footer.style} {theme} onstyle={setStyle} defaultLabel={t.theme.unset} />
  </div>
</details>

<style>
  h3 { margin: 1.2rem 0 0.5rem; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #5b4cdb; }
  .problem { position: sticky; top: -0.9rem; z-index: 1; margin: 0 -0.9rem 0.6rem; padding: 0.5rem 0.9rem; background: #fdecea; }
  .choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.4rem; }
  .choice { padding: 0.5rem; border: 1px solid #dddbe6; border-radius: 8px; font-size: 12px; text-align: center; cursor: pointer; background: #fff; }
  .choice.on { border: 2px solid #5b4cdb; padding: calc(0.5rem - 1px); }
  .choice input { position: absolute; opacity: 0; pointer-events: none; }
  .choice:has(input:focus-visible) { outline: 2px solid #5b4cdb; outline-offset: 2px; }
  details { margin: 0.6rem 0; border: 1px solid #e4e2ee; border-radius: 6px; padding: 0.5rem 0.6rem; }
  summary { cursor: pointer; font-weight: 600; }
  details[open] > summary { margin-bottom: 0.6rem; }
</style>
