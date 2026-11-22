/**
 * A ZIP file (ADR 0057 d4): the static export as one download, opened by
 * any computer and taken by any static host. Each file is compressed with
 * deflate; a ZIP of a few hundred megabytes needs nothing more (no ZIP64).
 */
import { deflateRawSync } from 'node:zlib';

const encoder = new TextEncoder();

/** The DOS date and time a ZIP keeps, from a date. */
function dosTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((Math.max(1980, at.getFullYear()) - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/** The files, by their path inside the ZIP, as one ZIP file's bytes. */
export function zipFiles(files: Map<string, string | Uint8Array>, at = new Date()): Uint8Array {
  const { time, date } = dosTime(at);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const paths = [...files.keys()].sort();
  for (const path of paths) {
    const value = files.get(path) as string | Uint8Array;
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    const packed = deflateRawSync(bytes);
    // A file deflate cannot make smaller (a picture, already compressed) is kept as it is.
    const stored = packed.length >= bytes.length;
    const body = stored ? bytes : packed;
    const name = encoder.encode(path);
    const crc = Bun.hash.crc32(bytes) >>> 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    // Bit 11: the name is UTF-8.
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, stored ? 0 : 8, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, body);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, stored ? 0 : 8, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, body.length, true);
    entry.setUint32(24, bytes.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const size = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, paths.length, true);
  end.setUint16(10, paths.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, part) => n + part.length, 0));
  let position = 0;
  for (const part of all) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}
