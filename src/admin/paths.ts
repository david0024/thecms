/** Reading and writing one value inside a block's content by a path like `items.0.title`. */

export function getPath(source: unknown, path: string): unknown {
  let at: unknown = source;
  for (const key of path.split('.')) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

/** A copy of `source` with the value at `path` replaced. Nothing is mutated. */
export function setPath<T>(source: T, path: string, value: unknown): T {
  const [key, ...rest] = path.split('.') as [string, ...string[]];
  const base: Record<string, unknown> | unknown[] = Array.isArray(source)
    ? [...source]
    : { ...((source ?? {}) as Record<string, unknown>) };
  const child = (base as Record<string, unknown>)[key];
  (base as Record<string, unknown>)[key] = rest.length ? setPath(child ?? {}, rest.join('.'), value) : value;
  return base as T;
}
