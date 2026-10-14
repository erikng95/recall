import { live, VERDICT_INFO, type Vault } from '@shared/vault.ts';
import { topicPath } from '../store.ts';

// --- Minimal ZIP writer (STORE, no compression) ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(files: { name: string; content: string }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/zip' });
}

// --- Vault → Markdown files ---

function safe(s: string) {
  return s.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
}

function yamlStr(s: string) {
  return JSON.stringify(s);
}

export function exportMarkdownZip(v: Vault): Blob {
  const files: { name: string; content: string }[] = [];
  const used = new Set<string>();
  for (const n of live(v.notes)) {
    const folder = n.topicIds[0] ? topicPath(v, n.topicIds[0]).split(' / ').map(safe).join('/') + '/' : '';
    let name = `${folder}${safe(n.title)}.md`;
    let i = 2;
    while (used.has(name.toLowerCase())) name = `${folder}${safe(n.title)} ${i++}.md`;
    used.add(name.toLowerCase());

    const fm: string[] = ['---'];
    if (n.topicIds.length) fm.push(`topics: [${n.topicIds.map((t) => yamlStr(topicPath(v, t))).join(', ')}]`);
    if (n.tags.length) fm.push(`tags: [${n.tags.map(yamlStr).join(', ')}]`);
    if (n.source) {
      fm.push('source:');
      for (const [k, val] of Object.entries(n.source)) if (val) fm.push(`  ${k}: ${yamlStr(String(val))}`);
    }
    if (n.verification && n.verification.verdict !== 'unchecked') {
      fm.push(`verdict: ${yamlStr(VERDICT_INFO[n.verification.verdict].label)}`);
      if (n.verification.confidence !== undefined) fm.push(`confidence: ${n.verification.confidence}`);
    }
    fm.push(`created: ${new Date(n.createdAt).toISOString()}`, `updated: ${new Date(n.updatedAt).toISOString()}`, '---', '');

    let body = n.body;
    const ver = n.verification;
    if (ver && ver.verdict !== 'unchecked') {
      body += `\n\n## Fact-check: ${VERDICT_INFO[ver.verdict].label}\n\n${ver.summary ?? ''}\n`;
      for (const e of ver.evidence ?? []) body += `\n- (${e.stance}) ${e.url ? `[${e.title}](${e.url})` : e.title}${e.note ? ` — ${e.note}` : ''}`;
    }
    const cards = live(v.cards).filter((c) => c.noteId === n.id && !c.auto);
    if (cards.length) {
      body += `\n\n## Flashcards\n`;
      for (const c of cards) body += `\n${c.front.replace(/\n/g, ' ')}\n?\n${c.back}\n`;
    }
    files.push({ name: `Recall/${name}`, content: fm.join('\n') + body + '\n' });
  }
  return makeZip(files);
}
