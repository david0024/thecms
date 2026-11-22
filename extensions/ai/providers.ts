/**
 * One request to the model the owner chose, through the program (ADR 0027):
 * the extension has no network of its own, so every call goes by `host.fetch`,
 * to a host it declared. The answer is always a list of texts, one for each
 * place it was asked to write, in the same order.
 */
import Anthropic from '@anthropic-ai/sdk';

type Host = import('../../src/site/extension-runner.ts').ExtensionHost;

export interface Provider {
  name: string;
  kind: 'anthropic' | 'openai' | 'ollama';
  model: string;
  api_key: string;
  base_url: string;
}

export interface Ask {
  system: string;
  prompt: string;
  /** How hard the model thinks, where it can be told: translating asks for more than a description. */
  effort: 'low' | 'medium';
  /** Pictures the model looks at, in order, before it reads the prompt (ADR 0059 d3). */
  images?: { type: string; data: string }[];
}

export interface Answer {
  texts: string[];
  model: string;
  input: number;
  output: number;
}

export const DEFAULT_MODEL = { anthropic: 'claude-opus-5-5' } as const;
const OLLAMA = 'http://localhost:11434';

/** The answer's shape, the same for every service. */
const SCHEMA = {
  type: 'object',
  properties: { texts: { type: 'array', items: { type: 'string' } } },
  required: ['texts'],
  additionalProperties: false,
} as const;

/** The provider the owner marked, or the first one. */
export function chosen(rows: Record<string, unknown>[]): Provider {
  const row = rows.find((r) => r.default === true) ?? rows[0];
  if (!row) throw new Error('Add a provider first: Extensions, AI writing, AI providers.');
  const kind = row.kind === 'openai' || row.kind === 'ollama' ? row.kind : 'anthropic';
  const model = String(row.model ?? '').trim() || (kind === 'anthropic' ? DEFAULT_MODEL.anthropic : '');
  if (!model) throw new Error(`Write the name of the model "${String(row.name)}" uses.`);
  const api_key = String(row.api_key ?? '');
  if (kind !== 'ollama' && !api_key) throw new Error(`"${String(row.name)}" has no API key.`);
  return { name: String(row.name ?? kind), kind, model, api_key, base_url: String(row.base_url ?? '').trim().replace(/\/+$/, '') };
}

/** The texts out of what the model wrote, or why there are none. */
function texts(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The model did not answer in the form it was asked for. Try again.');
  }
  const list = (parsed as { texts?: unknown })?.texts;
  if (!Array.isArray(list) || !list.every((t) => typeof t === 'string')) throw new Error('The model did not answer in the form it was asked for. Try again.');
  return list;
}

/** A call the service refused, in its own words when it gave them. */
function refused(service: string, status: number, body: string): Error {
  let said = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    said = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? '');
  } catch {
    said = body.slice(0, 200);
  }
  return new Error(`${service} answered ${status}${said ? `: ${said}` : ''}`);
}

/** `fetch` for the SDK, made of `host.fetch`. */
export function hostFetch(host: Host): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const answer = await host.fetch(String(url instanceof Request ? url.url : url), { method: init?.method ?? 'GET', headers, ...(body === undefined ? {} : { body }) });
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  }) as typeof fetch;
}

async function anthropic(provider: Provider, ask: Ask, host: Host): Promise<Answer> {
  const client = new Anthropic({ apiKey: provider.api_key, fetch: hostFetch(host), maxRetries: 2, timeout: 280_000 });
  const response = await client.beta.messages.create({
    model: provider.model,
    max_tokens: 16000,
    // When the model declines, the request is run again on the fallback model Anthropic picks, in the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: ask.system,
    messages: [
      {
        role: 'user',
        content: ask.images?.length
          ? [
              ...ask.images.map((image) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.type as 'image/png', data: image.data } })),
              { type: 'text' as const, text: ask.prompt },
            ]
          : ask.prompt,
      },
    ],
    output_config: { effort: ask.effort, format: { type: 'json_schema', schema: SCHEMA } },
  });
  if (response.stop_reason === 'refusal') throw new Error('The model would not write this.');
  if (response.stop_reason === 'max_tokens') throw new Error('The answer was too long for one request. Try a shorter part.');
  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return { texts: texts(text), model: response.model, input: response.usage.input_tokens, output: response.usage.output_tokens };
}

async function openai(provider: Provider, ask: Ask, host: Host): Promise<Answer> {
  const answer = await host.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.api_key}` },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: ask.system },
        {
          role: 'user',
          content: ask.images?.length
            ? [...ask.images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.type};base64,${image.data}` } })), { type: 'text', text: ask.prompt }]
            : ask.prompt,
        },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'texts', strict: true, schema: SCHEMA } },
    }),
  });
  if (answer.status !== 200) throw refused('OpenAI', answer.status, answer.body);
  const parsed = JSON.parse(answer.body) as { model?: string; choices?: { message?: { content?: string | null; refusal?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const message = parsed.choices?.[0]?.message;
  if (message?.refusal) throw new Error('The model would not write this.');
  return { texts: texts(message?.content ?? ''), model: parsed.model ?? provider.model, input: parsed.usage?.prompt_tokens ?? 0, output: parsed.usage?.completion_tokens ?? 0 };
}

async function ollama(provider: Provider, ask: Ask, host: Host): Promise<Answer> {
  const answer = await host.fetch(`${provider.base_url || OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(provider.api_key ? { authorization: `Bearer ${provider.api_key}` } : {}) },
    body: JSON.stringify({
      model: provider.model,
      stream: false,
      format: SCHEMA,
      messages: [
        { role: 'system', content: ask.system },
        { role: 'user', content: ask.prompt, ...(ask.images?.length ? { images: ask.images.map((image) => image.data) } : {}) },
      ],
    }),
  });
  if (answer.status !== 200) throw refused('Ollama', answer.status, answer.body);
  const parsed = JSON.parse(answer.body) as { model?: string; message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
  return { texts: texts(parsed.message?.content ?? ''), model: parsed.model ?? provider.model, input: parsed.prompt_eval_count ?? 0, output: parsed.eval_count ?? 0 };
}

/** Asks the provider, and checks that it wrote one text for each place. */
export async function complete(provider: Provider, ask: Ask, count: number, host: Host): Promise<Answer> {
  const answer = await (provider.kind === 'openai' ? openai : provider.kind === 'ollama' ? ollama : anthropic)(provider, ask, host);
  if (answer.texts.length !== count) throw new Error(`The model wrote ${answer.texts.length} texts for ${count} places. Try again.`);
  return answer;
}
