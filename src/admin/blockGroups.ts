/**
 * How "Add a block" shows the blocks (ADR 0073): in groups, in the order a
 * page is built, with a search that also knows the words people look for
 * ("YouTube", "map", "FAQ"). Only the admin's way of listing them: a block
 * is the same wherever it is listed.
 */
import type { BlockType } from '../core/index.ts';

export const BLOCK_GROUPS: { id: string; types: BlockType[] }[] = [
  { id: 'text', types: ['text', 'buttons', 'table', 'code'] },
  { id: 'media', types: ['image', 'gallery', 'video', 'audio', 'files', 'embed'] },
  { id: 'ready', types: ['hero', 'services', 'pricing', 'testimonials', 'faq', 'contact'] },
  { id: 'forms', types: ['form', 'search'] },
  { id: 'lists', types: ['entries', 'archive', 'entry'] },
  { id: 'layout', types: ['group', 'section'] },
];

/** Other words a block is found by, in any of the admin's languages. */
export const BLOCK_WORDS: Partial<Record<BlockType, string>> = {
  text: 'paragraph heading title words paragraf titlu',
  buttons: 'link call to action cta legatura',
  table: 'grid rows columns randuri coloane',
  code: 'snippet terminal',
  image: 'picture photo poza fotografie',
  gallery: 'photos pictures album poze fotografii',
  video: 'film mp4 clip',
  audio: 'sound music song podcast mp3 muzica melodie',
  files: 'pdf download document descarcare',
  embed: 'youtube vimeo spotify soundcloud map google maps harta iframe',
  hero: 'banner header top cover intro deschidere',
  services: 'features cards offer carduri oferta',
  pricing: 'prices plans packages preturi planuri pachete',
  testimonials: 'reviews quotes recenzii pareri citate',
  faq: 'faq questions answers accordion intrebari raspunsuri frecvente',
  contact: 'address phone email map adresa telefon',
  form: 'contact quote booking message mesaj oferta rezervare',
  search: 'find cauta',
  entries: 'posts blog articles latest recent articole',
  archive: 'months dates luni',
  entry: 'part field camp',
  group: 'columns container box row coloane cutie rand',
  section: 'reusable shared refolosit',
};

/** Lower case, without the marks over letters: "Hartă" is found by "harta". */
export const plain = (text: string): string => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Whether every word asked is in what is said of the block. */
export const matches = (asked: string, ...said: string[]): boolean => {
  const words = plain(asked).split(/\s+/).filter(Boolean);
  const haystack = plain(said.join(' '));
  return words.every((word) => haystack.includes(word));
};
