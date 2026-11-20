<script lang="ts">
/**
 * What visitors wrote under an entry (ADR 0040): the comments the owner
 * approved, then a plain HTML form for a new one. Like a contact form, it
 * posts to the site's form service, which sends the visitor back here at
 * `#comment-sent` or `#comment-failed`; no script. Without a form service the
 * site has nowhere to send, so only what was approved is shown.
 */
import type { ContentType, Post, Site } from '../core/index.ts';
import { entryPath } from '../core/index.ts';
import { dateText, wordsFor } from './words.ts';

let { site, type, post }: { site: Site; type: ContentType; post: Post } = $props();
const words = $derived(wordsFor(site.language));
const shown = $derived(post.comments ?? []);
const action = $derived(site.forms ? `${site.forms}/comment` : '');
</script>

{#if shown.length || action}
  <section class="b b-comments" id="comments" aria-labelledby="comments-heading">
    <div class="b-in">
      <h2 id="comments-heading">{words.comments}</h2>
      {#if shown.length}
        <ol class="comments">
          {#each shown as c (c.id)}
            <li class="comment" id={`comment-${c.id}`}>
              <p class="comment-by"><strong>{c.name}</strong> <time datetime={c.at}>{dateText(c.at.slice(0, 10), site.language)}</time></p>
              <p class="comment-body">{c.body}</p>
            </li>
          {/each}
        </ol>
      {/if}
      {#if action}
        <h3>{words.commentWrite}</h3>
        <p class="form-note form-sent" id="comment-sent" role="status">{words.commentSent}</p>
        <p class="form-note form-failed" id="comment-failed" role="alert">{words.commentFailed}</p>
        <form class="form" method="post" {action} accept-charset="utf-8">
          <input type="hidden" name="back" value={entryPath(type, post.slug)} />
          <input type="hidden" name="type" value={type.id} />
          <input type="hidden" name="entry" value={post.slug} />
          <!-- Left empty by people; a robot that fills every field gives itself away. -->
          <p class="form-trap" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off" /></label></p>
          <p class="form-field"><label for="comment-name">{words.formName}</label><input id="comment-name" name="name" type="text" maxlength="120" autocomplete="name" required /></p>
          <p class="form-field"><label for="comment-email">{words.formEmail}</label><input id="comment-email" name="email" type="email" maxlength="254" autocomplete="email" required /></p>
          <p class="form-field"><label for="comment-text">{words.comment}</label><textarea id="comment-text" name="comment" rows="5" maxlength="3000" required></textarea></p>
          <p class="form-consent"><input id="comment-consent" name="consent" type="checkbox" value="yes" required /><label for="comment-consent">{words.commentConsent}</label></p>
          <p><button class="button" type="submit">{words.commentSend}</button></p>
        </form>
      {/if}
    </div>
  </section>
{/if}
