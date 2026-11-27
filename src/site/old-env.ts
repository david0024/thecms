/**
 * The environment of a site set up before the rename (ADR 0066): each
 * THECMS_… it still gives stands for the UHLAKA_… of the same name, unless
 * that one is given too. Imported first, before anything reads the
 * environment.
 */
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith('THECMS_') || value === undefined) continue;
  const now = `UHLAKA_${key.slice('THECMS_'.length)}`;
  if (process.env[now] === undefined) process.env[now] = value;
}
