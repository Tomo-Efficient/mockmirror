import zlib from 'node:zlib';

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

export function unzip(buf) {
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('不是有效的 ZIP/DOCX 文件');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      const local = entry.localOffset;
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('ZIP 局部头损坏');
      const nameLen = buf.readUInt16LE(local + 26);
      const extraLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + nameLen + extraLen;
      const data = buf.subarray(start, start + entry.compSize);
      if (entry.method === 0) return Buffer.from(data);
      if (entry.method === 8) return zlib.inflateRawSync(data);
      throw new Error(`不支持的压缩方式 ${entry.method}`);
    }
  };
}

const decodeXml = (s) => s
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

export function extractDocxText(buffer) {
  const zip = unzip(buffer);
  const xml = zip.read('word/document.xml');
  if (!xml) throw new Error('DOCX 中缺少 word/document.xml');
  const body = xml.toString('utf8');

  const lines = [];
  const paragraphs = body.split(/<w:p[\s>]/).slice(1);
  for (const block of paragraphs) {
    const content = block.split('</w:p>')[0];
    if (/<w:tbl[\s>]/.test(content) && !/<w:t[\s>]/.test(content)) continue;
    let text = '';
    const tokens = content.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g) || [];
    for (const token of tokens) {
      if (token === '<w:tab/>') {
        text += '\t';
      } else if (token === '<w:br/>' || token === '<w:cr/>') {
        text += '\n';
      } else if (/^<w:t[\s>]/.test(token)) {
        text += decodeXml(token.replace(/^<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>$/, ''));
      }
    }
    if (text.trim()) lines.push(text.replace(/\u00a0/g, ' ').trim());
  }

  // 表格中常含有学校、公司等关键信息，补充扫描表格单元格
  if (lines.length < 6) {
    const cells = [...body.matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map((m) => {
      const t = [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => decodeXml(x[1])).join('');
      return t.trim();
    }).filter(Boolean);
    lines.push(...cells);
  }
  return lines.join('\n');
}
