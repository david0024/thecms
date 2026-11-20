/**
 * What a site would get wrong once it is published (ADR 0029), read from the
 * files an export writes: a link to an address on the site that nothing
 * answers, and a picture with no words for those who cannot see it.
 *
 * It reads the output, not the pages, so every link counts: one typed in a
 * text, a button, the menu, the footer. A link is to the site when it starts
 * with one `/`; one elsewhere is not followed.
 */

export interface SiteCheck {
  /** An address nothing answers, and the pages that link to it. Publishing stops on these. */
  broken: { href: string; from: string[] }[];
  /** A picture with no description, and the pages that show it. Said, not stopped. */
  unnamed: { src: string; on: string[] }[];
}

const LINK = /<a\b[^>]*?\shref="([^"]*)"/g;
const IMAGE = /<img\b[^>]*>/g;
const ATTRIBUTE = (name: string) => new RegExp(`\\s${name}="([^"]*)"`);

const unescape = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The address a file is served at: `about/index.html` is `/about/`. */
const addressOf = (file: string): string => `/${file.replace(/(^|\/)index\.html$/, '$1')}`;

/** Whether one of the files answers an address. */
function answers(files: Map<string, unknown>, href: string): boolean {
  let path = href.split(/[?#]/)[0] ?? href;
  try {
    path = decodeURI(path);
  } catch {
    return false;
  }
  if (path.endsWith('/')) return files.has(`${path.slice(1)}index.html`);
  return files.has(path.slice(1)) || files.has(`${path.slice(1)}/index.html`);
}

function add<T extends string>(map: Map<string, Set<string>>, key: T, where: string): void {
  const at = map.get(key) ?? new Set<string>();
  at.add(where);
  map.set(key, at);
}

export function checkSite(files: Map<string, string | Uint8Array>): SiteCheck {
  const broken = new Map<string, Set<string>>();
  const unnamed = new Map<string, Set<string>>();
  for (const [file, contents] of files) {
    if (!file.endsWith('.html') || typeof contents !== 'string') continue;
    const page = addressOf(file);
    for (const [, raw = ''] of contents.matchAll(LINK)) {
      const href = unescape(raw);
      if (!href.startsWith('/') || href.startsWith('//')) continue;
      // The same address with another part after it is the same address.
      if (!answers(files, href)) add(broken, href.split(/[?#]/)[0] ?? href, page);
    }
    for (const [tag] of contents.matchAll(IMAGE)) {
      const alt = tag.match(ATTRIBUTE('alt'))?.[1] ?? '';
      if (alt.trim()) continue;
      add(unnamed, unescape(tag.match(ATTRIBUTE('src'))?.[1] ?? ''), page);
    }
  }
  const sorted = (map: Map<string, Set<string>>) => [...map].sort(([a], [b]) => a.localeCompare(b)).map(([key, at]) => [key, [...at].sort()] as const);
  return {
    broken: sorted(broken).map(([href, from]) => ({ href, from })),
    unnamed: sorted(unnamed).map(([src, on]) => ({ src, on })),
  };
}

/** The findings in plain lines, for the command line. */
export function describeCheck(check: SiteCheck): { problems: string[]; warnings: string[] } {
  const pages = (list: readonly string[]): string => (list.length > 3 ? `${list.slice(0, 3).join(', ')} and ${list.length - 3} more` : list.join(', '));
  return {
    problems: check.broken.map((b) => `${b.href} does not exist; linked from ${pages(b.from)}`),
    warnings: check.unnamed.map((u) => `${u.src} has no description, on ${pages(u.on)}`),
  };
}
