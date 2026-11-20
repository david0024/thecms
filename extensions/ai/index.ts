/**
 * AI writing for thecms (ADR 0027): an extension like any other (ADR 0026).
 * Each action takes the words of a block or a page, asks the model the owner
 * chose for new ones, and gives the block or the page back with them. The
 * editor shows that as a change, to look at, undo or save.
 */
import { type Ask, chosen, complete } from './providers.ts';
import { type Block, blockWords, languageName, type Page, pageWords, type Place, withBlockWords, withPageWords } from './words.ts';

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
};
