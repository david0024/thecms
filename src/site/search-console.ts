/**
 * Google Search Console (ADR 0064 d3): what people searched for when Google
 * showed the site, and which pages they found, read with a service account the
 * owner adds to the site's property. Nothing is sent to Google but the asking.
 */
import { isObject, str } from '../core/index.ts';

/** What the site keeps to ask Google: the service account's key, and which property it reads. */
export interface SearchConsoleSettings {
  clientEmail: string;
  privateKey: string;
  /** `https://example.com/` or `sc-domain:example.com`, as Search Console names it. */
  property: string;
}

/** One row of a report: a search or a page, with what Google counted for it. */
export interface SearchRow {
  key: string;
  clicks: number;
  impressions: number;
  /** Clicks for each time it was shown, from 0 to 1. */
  ctr: number;
  /** Where it was on average in the results, 1 the first. */
  position: number;
}

export interface SearchReport {
  /** The days counted, `YYYY-MM-DD`, both included. */
  from: string;
  to: string;
  queries: SearchRow[];
  pages: SearchRow[];
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
/** How many days a report counts: Google's data for the last days is not final yet, so it ends three days ago. */
export const REPORT_DAYS = 28;
const ROWS = 25;

/**
 * The key file Google gives for a service account, and the property, made
 * safe to keep; null with a reason when it is not one.
 */
export function cleanSearchConsole(input: unknown, siteUrl: string): { settings: SearchConsoleSettings } | { problem: string } {
  const raw = isObject(input) ? input : {};
  let key: unknown = raw.key;
  if (typeof key === 'string') {
    try {
      key = JSON.parse(key);
    } catch {
      return { problem: 'the key is the JSON file Google gives for a service account' };
    }
  }
  if (!isObject(key) || key.type !== 'service_account' || typeof key.client_email !== 'string' || typeof key.private_key !== 'string' || !key.private_key.includes('PRIVATE KEY')) {
    return { problem: 'the key is the JSON file Google gives for a service account' };
  }
  const asked = str(raw.property, 300).trim();
  const property = asked || (siteUrl ? `${siteUrl}/` : '');
  if (!/^(https?:\/\/[^\s/]+\/|sc-domain:[a-z0-9.-]+)$/i.test(property)) return { problem: 'the property is the site\'s address, such as https://example.com/, or sc-domain:example.com' };
  return { settings: { clientEmail: str(key.client_email, 300), privateKey: key.private_key, property } };
}

const base64url = (bytes: Uint8Array | string): string => Buffer.from(bytes).toString('base64url');

/** A token to read Search Console, from a JWT signed with the service account's key. */
async function accessToken(settings: SearchConsoleSettings, send: Fetch, now: number): Promise<string> {
  const at = Math.floor(now / 1000);
  const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: settings.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: at, exp: at + 3600 }));
  const der = Buffer.from(settings.privateKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claims}`)));
  const response = await send(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${base64url(signature)}` }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const answer = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!response.ok || !answer.access_token) throw new Error(`Google did not accept the key: ${answer.error_description ?? answer.error ?? response.status}`);
  return answer.access_token;
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** What people searched for and which pages they found, over the last {@link REPORT_DAYS} days Google has counted. */
export async function searchReport(settings: SearchConsoleSettings, options: { fetch?: Fetch; now?: number } = {}): Promise<SearchReport> {
  const send = options.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const now = options.now ?? Date.now();
  const token = await accessToken(settings, send, now);
  const to = day(now - 3 * 86_400_000);
  const from = day(now - (3 + REPORT_DAYS - 1) * 86_400_000);
  const query = async (dimension: 'query' | 'page'): Promise<SearchRow[]> => {
    const response = await send(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(settings.property)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ startDate: from, endDate: to, dimensions: [dimension], rowLimit: ROWS }),
      signal: AbortSignal.timeout(15_000),
    });
    const answer = (await response.json().catch(() => ({}))) as { rows?: { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }[]; error?: { message?: string } };
    if (!response.ok) throw new Error(`Search Console did not answer: ${answer.error?.message ?? response.status}`);
    return (answer.rows ?? []).map((row) => ({
      key: String(row.keys?.[0] ?? ''),
      clicks: Number(row.clicks ?? 0),
      impressions: Number(row.impressions ?? 0),
      ctr: Number(row.ctr ?? 0),
      position: Math.round(Number(row.position ?? 0) * 10) / 10,
    }));
  };
  return { from, to, queries: await query('query'), pages: await query('page') };
}
