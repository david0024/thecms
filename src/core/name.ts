/**
 * The product's name, in one place (ADR 0066): changing it here changes the
 * command, the cookies, the admin's title and the release files.
 */
export const NAME = 'uhlaka';
/** As people read it. */
export const DISPLAY_NAME = 'Uhlaka';
/** Where releases are published (GitHub Releases), as `owner/repository`. */
export const REPOSITORY = 'uhlaka-devs/uhlaka';

/** The name it had before (ADR 0066): what was made under it is still read. */
export const OLD_NAME = 'thecms';

const OLD_FORMAT = new RegExp(`^${OLD_NAME}\\.([a-z]+/\\d+)$`);

/**
 * A file or a value made before the rename, as it would be written now
 * (ADR 0066): `thecms.content/1` is `uhlaka.content/1`, and an extension's
 * `thecmsMinVersion` is its `uhlakaMinVersion`. Anything else is returned as
 * it is, and nothing is changed in place.
 */
export function fromOldName<T>(value: T): T {
  if (typeof value === 'string') {
    const m = OLD_FORMAT.exec(value);
    return (m ? `${NAME}.${m[1]}` : value) as T;
  }
  if (Array.isArray(value)) return value.map(fromOldName) as T;
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) out[key === `${OLD_NAME}MinVersion` ? `${NAME}MinVersion` : key] = fromOldName(inner);
  return out as T;
}
