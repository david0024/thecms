/**
 * The site's clock (ADR 0037 d2, ADR 0039): what has to happen at a time
 * without anyone asking. It publishes what was set for later, forgets
 * messages kept long enough, and runs the extensions' jobs that are due (ADR
 * 0041). The editor and the runtime each run one; a publication or a job is
 * claimed before it is done, so it happens once.
 */
import type { Store } from './store.ts';

/** How often the clock looks: a publication set for 10:00 is on the site within this. */
export const TICK_MS = 30_000;

export interface Clock {
  /** One look, now: what it published. */
  tick: () => Promise<string[]>;
  stop: () => void;
}

export function startClock(
  store: Store,
  options: {
    every?: number;
    log?: (line: string) => void;
    now?: () => Date;
    run?: boolean;
    jobs?: (now: Date) => Promise<unknown>;
    /** Takes the tick for this process, where several share one site (ADR 0044 d4): one looks, the others wait for the next. */
    claim?: (key: string, ms: number) => Promise<boolean>;
  } = {},
): Clock {
  const log = options.log ?? ((line: string) => console.log(line));
  let busy = false;
  const tick = async (): Promise<string[]> => {
    if (busy) return [];
    busy = true;
    try {
      const now = options.now?.() ?? new Date();
      const every = options.every ?? TICK_MS;
      if (options.claim && !(await options.claim(`clock:${Math.floor(now.getTime() / every)}`, every))) return [];
      const done = await store.publishDue(now);
      const said = done.map((d) => (d.kind === 'page' ? `/${d.slug}${d.slug ? '/' : ''}` : `${d.kind}/${d.slug}`));
      if (said.length) log(`Published as set: ${said.join(', ')}`);
      await store.forgetOldMessages();
      await options.jobs?.(now);
      return said;
    } catch (error) {
      log(`The clock could not publish: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    } finally {
      busy = false;
    }
  };
  const timer = options.run === false ? null : setInterval(() => void tick(), options.every ?? TICK_MS);
  return { tick, stop: () => timer && clearInterval(timer) };
}
