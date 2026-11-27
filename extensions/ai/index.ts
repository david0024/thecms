/**
 * AI writing for Uhlaka (ADR 0027): an extension like any other (ADR 0026).
 * Each action takes the words of a block or a page, asks the model the owner
 * chose for new ones, and gives the block or the page back with them. The
 * editor shows that as a change, to look at, undo or save.
 */
import { type Ask, chosen, complete } from './providers.ts';
import { type Block, blockPictures, blockWords, languageName, type Page, pageWords, type Place, withBlockWords, withPageWords, withPictureWords } from './words.ts';

type Host = import('../../src/site/extension-runner.ts').ExtensionHost;
interface Site {
  name: string;
  language: string;
  languages: string[];
}

const RULES = [
  'Answer with JSON: {"texts": [...]}, one text for each place you are given, in the same order.',
  'Each text is plain words for a reader: no Markdown, no HTML, no quotation marks around it.',
  'Keep a text the length its place calls for: a heading or a button stays short.',
  'Never invent prices, dates, names, addresses or promises the words do not already make.',
].join('\n');

/** Asks the owner's provider and writes down what it cost. */
async function ask(host: Host, action: string, question: Ask, count: number): Promise<string[]> {
  const provider = chosen(await host.collections.list('providers'));
  const answer = await complete(provider, question, count, host);
  await host.collections.insert('usage', { action, provider: provider.name, model: answer.model, input_tokens: answer.input, output_tokens: answer.output });
  return answer.texts;
}

const listed = (places: Place[]): string => JSON.stringify(places, null, 1);

export const actions = {
  /** Writes a block's words, or changes them, as the owner says. Empty places are written too. */
  async write(input: { block: Block; language: string; ask: { instruction?: string }; site: Site }, host: Host) {
    const places = blockWords(input.block, true);
    if (!places.length) throw new Error('This block has no words to write.');
    const instruction = input.ask.instruction?.trim() || 'Make these words clearer and correct them. Fill in any place that is empty.';
    const texts = await ask(host, 'write', {
      system: `You write the words of one block on the website "${input.site.name}". Write in ${languageName(input.language)}.\n${RULES}\nA place whose text is empty is yours to write; leave a place as it is when the instruction does not concern it.`,
      prompt: `The block is a "${input.block.type}". Its places:\n${listed(places)}\n\nWhat the owner asks:\n${instruction}`,
      effort: 'low',
    }, places.length);
    return { block: withBlockWords(input.block, texts, true) };
  },

  /**
   * Translates a page into its own language: the page under `ro/` comes out in
   * Romanian. Run on the main page, the editor runs it for each language, and
   * keeps only the words each translation does not say yet (ADR 0034).
   */
  async translate(input: { page: Page; language: string; site: Site }, host: Host) {
    const places = pageWords(input.page);
    const into = languageName(input.language);
    const texts = await ask(host, 'translate', {
      system: `You translate the pages of the website "${input.site.name}" into ${into}.\n${RULES}\nTranslate the meaning, as a person who writes ${into} well would say it, not word for word. Names of the business, of people and of products stay as they are. A text already in ${into} stays as it is.`,
      prompt: `The page "${input.page.title}", place by place:\n${listed(places)}`,
      effort: 'medium',
    }, places.length);
    return { page: withPageWords(input.page, texts) };
  },

  /** Writes the description search engines and link previews show, from what the page says. */
  async describe(input: { page: Page; language: string; site: Site }, host: Host) {
    const places = pageWords(input.page).filter((p) => p.place !== 'description');
    const [description = ''] = await ask(host, 'describe', {
      system: `You write the description search engines show for a page of the website "${input.site.name}". Write in ${languageName(input.language)}.\n${RULES}\nThere is one place: the description, one or two sentences, at most 155 characters, that say what a reader finds on the page.`,
      prompt: `The page, place by place:\n${listed(places)}`,
      effort: 'low',
    }, 1);
    return { page: { ...input.page, description: description.slice(0, 300) } };
  },

  /** Writes the title search engines show in place of the page's own (ADR 0059 d1). */
  async title(input: { page: Page; language: string; site: Site }, host: Host) {
    const places = pageWords(input.page);
    const [title = ''] = await ask(host, 'title', {
      system: `You write the title search engines show for a page of the website "${input.site.name}". Write in ${languageName(input.language)}.\n${RULES}\nThere is one place: the title, at most 60 characters, that says what the page offers in the words a person would search for, and ends with the site's name only if it fits. No quotation marks, no shouting, no emoji.`,
      prompt: `The page, place by place:\n${listed(places)}`,
      effort: 'low',
    }, 1);
    return { page: { ...input.page, seoTitle: title.replace(/\s+/g, ' ').trim().slice(0, 70) } };
  },

  /**
   * Writes each picture's words from the picture itself (ADR 0059 d2): those
   * that have none, or every one when all have some. The model sees the
   * pictures, the block's words for what is around them, and nothing else.
   */
  async pictures(input: { block: Block; language: string; site: Site }, host: Host) {
    const all = blockPictures(input.block);
    if (!all.length) throw new Error('This block has no pictures of the site to describe.');
    const empty = all.filter((p) => !p.alt.trim());
    const chosen = (empty.length ? empty : all).slice(0, MAX_PICTURES);
    const seen = await Promise.all(chosen.map((p) => host.picture(p.src)));
    const images = seen.flatMap((image, i) => (image && LOOKABLE.has(image.type) ? [{ image, picture: chosen[i] as (typeof chosen)[number] }] : []));
    if (!images.length) throw new Error('These pictures cannot be shown to the model: upload them again as JPEG, PNG or WebP.');
    const around = blockWords(input.block).filter((p) => !/(^|\.)alt$/.test(p.place));
    const texts = await ask(host, 'pictures', {
      system: `You write the words that describe pictures on the website "${input.site.name}", for people who cannot see them and for search engines. Write in ${languageName(input.language)}.\n${RULES}\nThere is one place for each picture, in the order they are shown: say in at most 125 characters what the picture shows that matters on this page. Do not begin with "picture of" or "image of". Do not guess names of people or places the words around do not give.`,
      prompt: `${images.length} picture(s), in order. The words around them in the block:\n${listed(around)}`,
      effort: 'low',
      images: images.map(({ image }) => image),
    }, images.length);
    return { block: withPictureWords(input.block, images.map(({ picture }, i) => ({ at: picture.at, alt: (texts[i] ?? '').trim().slice(0, 300) }))) };
  },
};

/** At most this many pictures are described at once: a gallery's first twelve. */
const MAX_PICTURES = 12;
/** What every provider can look at. */
const LOOKABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
