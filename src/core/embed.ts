/**
 * What a page can show from another service (ADR 0047): a video, a song or a
 * map, from a known address. The author pastes the address they see in their
 * browser; the page draws the service's own player for it, from an address
 * made here. No HTML the author brings is ever put on a page.
 */

/** How a player is drawn: as wide as the text and in a video's proportions, a map's, or a fixed height. */
export type EmbedShape = 'video' | 'map' | 'audio' | 'audio-tall';

export interface Embed {
  provider: 'youtube' | 'vimeo' | 'spotify' | 'soundcloud' | 'google-maps' | 'openstreetmap';
  /** The player's address: made here, never the one pasted. */
  src: string;
  shape: EmbedShape;
  /** Whether it plays video, sound, or shows a map. */
  kind: 'video' | 'audio' | 'map';
}

/** The services a page may show players from: what the site's content policy lets frames load. */
export const EMBED_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://open.spotify.com',
  'https://w.soundcloud.com',
  'https://www.google.com',
  'https://www.openstreetmap.org',
] as const;

/** The services as an author reads them. */
export const EMBED_SERVICES = 'YouTube, Vimeo, Spotify, SoundCloud, Google Maps, OpenStreetMap';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** `1h2m3s`, `90s` or `90` as seconds. */
function seconds(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}

/** The player for an address, or null when it is not one of a known service's. */
export function embedOf(address: unknown): Embed | null {
  if (typeof address !== 'string' || address.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    const id = host === 'youtu.be' ? parts[0] : parts[0] === 'watch' || !parts.length ? url.searchParams.get('v') : ['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '') ? parts[1] : null;
    if (!id || !YOUTUBE_ID.test(id)) return null;
    const start = seconds(url.searchParams.get('t') ?? url.searchParams.get('start'));
    return { provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`, shape: 'video', kind: 'video' };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const at = parts[0] === 'video' ? 1 : parts.findIndex((p) => /^\d+$/.test(p));
    const id = parts[at];
    if (!id || !/^\d{1,12}$/.test(id)) return null;
    // An unlisted video carries its key after the number, or as `h`.
    const key = url.searchParams.get('h') ?? parts[at + 1];
    const hash = key && /^[a-f0-9]{6,20}$/.test(key) ? `&h=${key}` : '';
    return { provider: 'vimeo', src: `https://player.vimeo.com/video/${id}?dnt=1${hash}`, shape: 'video', kind: 'video' };
  }
  if (host === 'open.spotify.com') {
    const rest = parts[0] === 'embed' ? parts.slice(1) : parts[0]?.startsWith('intl-') ? parts.slice(1) : parts;
    const [type, id] = rest;
    if (!type || !id || !['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(type) || !/^[A-Za-z0-9]{10,40}$/.test(id)) return null;
    return { provider: 'spotify', src: `https://open.spotify.com/embed/${type}/${id}`, shape: type === 'track' || type === 'episode' ? 'audio' : 'audio-tall', kind: 'audio' };
  }
  if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
    if (host === 'on.soundcloud.com' || parts.length < 2 || !parts.every((p) => /^[A-Za-z0-9_-]{1,100}$/.test(p))) return null;
    const page = `https://soundcloud.com/${parts.join('/')}`;
    return { provider: 'soundcloud', src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(page)}&visual=false`, shape: parts[1] === 'sets' ? 'audio-tall' : 'audio', kind: 'audio' };
  }
  if (host === 'google.com' && url.pathname === '/maps/embed') {
    const pb = url.searchParams.get('pb');
    if (!pb || !/^[A-Za-z0-9!._%:+-]{1,2000}$/.test(pb)) return null;
    return { provider: 'google-maps', src: `https://www.google.com/maps/embed?pb=${pb}`, shape: 'map', kind: 'map' };
  }
  if (host === 'openstreetmap.org' && url.pathname === '/export/embed.html') {
    const bbox = url.searchParams.get('bbox') ?? '';
    if (!/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(bbox)) return null;
    const layer = /^[a-z]{1,20}$/.test(url.searchParams.get('layer') ?? '') ? `&layer=${url.searchParams.get('layer')}` : '';
    const marker = /^-?[\d.]+,-?[\d.]+$/.test(url.searchParams.get('marker') ?? '') ? `&marker=${url.searchParams.get('marker')}` : '';
    return { provider: 'openstreetmap', src: `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}${layer}${marker}`, shape: 'map', kind: 'map' };
  }
  return null;
}
