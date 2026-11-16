<script lang="ts">
/**
 * What the site says about itself on every page: its name or logo, the button
 * in the header, the footer's words and links. How these are laid out is the
 * theme's (ADR 0006), so nothing here is a colour or a position.
 */
import type { LinkValue, Site } from '../core/index.ts';
import ImageField from './ImageField.svelte';
import { t } from './messages.ts';

let { site, onchange }: { site: Site; onchange: (site: Site) => void } = $props();

const set = (patch: Partial<Site>): void => onchange({ ...site, ...patch });
const link = (value: LinkValue | null, patch: Partial<LinkValue>): LinkValue => ({ label: value?.label ?? '', href: value?.href ?? '', ...patch });
const setFooterLink = (i: number, patch: Partial<LinkValue>): void => set({ footerLinks: site.footerLinks.map((l, j) => (j === i ? link(l, patch) : l)) });
</script>

<label class="field">
  <span>{t.site.name}</span>
  <input type="text" maxlength="120" value={site.name} oninput={(e) => e.currentTarget.value.trim() && set({ name: e.currentTarget.value })} data-site-name />
</label>
<label class="field">
  <span>{t.site.language}</span>
  <input type="text" maxlength="20" value={site.language} onchange={(e) => set({ language: e.currentTarget.value.trim() })} />
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
<p class="hint">{t.site.live}</p>

<style>
  h3 { margin: 1.1rem 0 0.5rem; font-size: 13px; }
</style>
