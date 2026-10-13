/**
 * Streaming ustar writer. Names that do not fit a classic header, and files
 * of 8 GB or more, get a pax extended header. Callers pad file bytes to 512
 * and finish with `tarEnd`.
 */

const USTAR_SIZE_MAX = 0o77777777777;

function writeOctal(buf: Buffer, offset: number, length: number, value: number): void {
  const text = Math.max(0, value).toString(8).padStart(length - 1, "0").slice(-(length - 1));
  buf.write(text, offset, length - 1, "ascii");
  buf[offset + length - 1] = 0;
}

function ustarHeader(name: string, size: number, typeflag: string): Buffer {
  const buf = Buffer.alloc(512, 0);
  const nameBytes = Buffer.from(name, "utf8");
  nameBytes.copy(buf, 0, 0, Math.min(100, nameBytes.length));
  writeOctal(buf, 100, 8, 0o644);
  writeOctal(buf, 108, 8, 0);
  writeOctal(buf, 116, 8, 0);
  writeOctal(buf, 124, 12, size);
  writeOctal(buf, 136, 12, 0);
  buf.fill(0x20, 148, 156);
  buf[156] = typeflag.charCodeAt(0);
  buf.write("ustar", 257, "ascii");
  buf[262] = 0;
  buf.write("00", 263, "ascii");
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  const oct = sum.toString(8).padStart(6, "0");
  buf.write(oct, 148, 6, "ascii");
  buf[154] = 0;
  buf[155] = 0x20;
  return buf;
}

function paxRecord(key: string, value: string): Buffer {
  const rest = Buffer.from(` ${key}=${value}\n`, "utf8");
  let total = rest.length + 1;
  while (true) {
    const next = rest.length + String(total).length;
    if (next === total) break;
    total = next;
  }
  return Buffer.concat([Buffer.from(String(total), "ascii"), rest]);
}

function padLength(size: number): number {
  return (512 - (size % 512)) % 512;
}

export function tarPadding(size: number): Buffer {
  return Buffer.alloc(padLength(size));
}

export function tarEnd(): Buffer {
  return Buffer.alloc(1024);
}

/** Header blocks that precede the file bytes. */
export function tarMemberPrefix(name: string, size: number, dir = false): Buffer {
  const clean = dir ? name.replace(/\/+$/, "") + "/" : name.replace(/\/+$/, "");
  const bytes = Buffer.from(clean, "utf8");
  const huge = !dir && size > USTAR_SIZE_MAX;
  const needsPax = huge || bytes.length > 100 || /[^\x00-\x7f]/.test(clean);
  const blocks: Buffer[] = [];
  if (needsPax) {
    const records = [paxRecord("path", clean)];
    if (huge) records.push(paxRecord("size", String(size)));
    const body = Buffer.concat(records);
    blocks.push(ustarHeader("./PaxHeaders.X/file", body.length, "x"), body, tarPadding(body.length));
  }
  const ascii = /^[\x00-\x7f]*$/.test(clean) && bytes.length <= 100;
  const shown = ascii ? clean : "file";
  const sizeField = dir ? 0 : huge ? 0 : size;
  blocks.push(ustarHeader(shown, sizeField, dir ? "5" : "0"));
  return Buffer.concat(blocks);
}

export function tarMemberOverhead(name: string, size: number, dir = false): number {
  return tarMemberPrefix(name, size, dir).length + (dir ? 0 : padLength(size));
}

export function tarArchiveSize(members: readonly { name: string; size: number; dir?: boolean }[]): number {
  let total = 1024;
  for (const member of members) {
    total += tarMemberOverhead(member.name, member.dir ? 0 : member.size, Boolean(member.dir));
    if (!member.dir) total += member.size;
  }
  return total;
}
