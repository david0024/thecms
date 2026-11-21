<script lang="ts">
/** Another service's player, in a frame that may run that service's script and nothing of the site's (ADR 0047). */
import type { Embed } from '../core/index.ts';

let { embed, title }: { embed: Embed; title: string } = $props();
</script>

<div class={['embed', `embed-${embed.shape}`]}>
  <iframe
    src={embed.src}
    title={title || embed.provider}
    loading="lazy"
    referrerpolicy="strict-origin-when-cross-origin"
    sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
    allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
    allowfullscreen
  ></iframe>
</div>
