<script lang="ts">
/**
 * A form a visitor writes to the owner with (ADR 0019). It is plain HTML: it
 * posts to the site's form service, which sends the visitor back to this page
 * at `#…-sent` or `#…-failed`, and the stylesheet shows the matching words.
 * No script, on the site or in the form.
 *
 * The site's own server answers it (ADR 0044), or the form service the
 * site's settings name, for a site exported to a static host.
 */
import { type Block, type FormContent, formsAddress } from '../core/index.ts';
import { getSite, isEditing, marker } from './editing.ts';
import { wordsFor } from './words.ts';

let { block }: { block: Block } = $props();
const c = $derived(block.content as unknown as FormContent);
const editing = isEditing();
const mark = marker();
const where = getSite();
const action = `${formsAddress(where?.site ?? { forms: '' })}/send`;
const id = (name: string): string => `f-${block.id}-${name}`;
const words = wordsFor(where?.site.language ?? 'en');
</script>

{#if c.title || editing}<h2 data-edit={mark('title')}>{c.title}</h2>{/if}
{#if c.intro || editing}<p class="lead" data-edit={mark('intro')} data-multiline={mark('1')}>{c.intro}</p>{/if}
<p class="form-note form-sent" class:shown={editing} id={id('sent')} role="status" data-edit={mark('sent')}>{c.sent}</p>
<p class="form-note form-failed" class:shown={editing} id={id('failed')} role="alert" data-edit={mark('failed')}>{c.failed}</p>
<form class="form" method="post" action={editing ? undefined : action} accept-charset="utf-8">
  <input type="hidden" name="back" value={where?.path ?? '/'} />
  <input type="hidden" name="form" value={block.id} />
  <!-- Left empty by people; a robot that fills every field gives itself away. -->
  <p class="form-trap" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off" /></label></p>
  <p class="form-field"><label for={id('name')}>{words.formName}</label><input id={id('name')} name="name" type="text" maxlength="120" autocomplete="name" required disabled={editing} /></p>
  <p class="form-field"><label for={id('email')}>{words.formEmail}</label><input id={id('email')} name="email" type="email" maxlength="254" autocomplete="email" required disabled={editing} /></p>
  <p class="form-field"><label for={id('message')}>{words.formMessage}</label><textarea id={id('message')} name="message" rows="6" maxlength="5000" required disabled={editing}></textarea></p>
  <p class="form-consent"><input id={id('consent')} name="consent" type="checkbox" value="yes" required disabled={editing} /><label for={id('consent')} data-edit={mark('consent')} data-multiline={mark('1')}>{c.consent}</label></p>
  <p><button class="button" type={editing ? 'button' : 'submit'}><span data-edit={mark('button')}>{c.button}</span></button></p>
</form>
