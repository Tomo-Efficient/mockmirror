import path from 'node:path';
import { extractDocxText } from './docx.js';
import { extractPdfText } from './pdf.js';

const MIME_BY_EXT = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown'
};

export function cleanText(raw) {
  return String(raw || '')
    .replace(/\u0000/g, '')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/\uf0b7|\uf0a7|\u25aa|\u25cf/g, '•')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, '  ').trim())
    .join('\n')
    .trim();
}

export async function parseUpload({ filename = '', mime = '', buffer, text = '' }) {
  const ext = path.extname(filename || '').toLowerCase();
  if (!buffer && !text) throw new Error('文件内容为空');
  if (!buffer) return cleanText(text);

  const sizeMb = buffer.length / 1024 / 1024;
  if (sizeMb > 10) throw new Error('文件超过 10MB，请压缩后重试');

  if (ext === '.docx' || mime === MIME_BY_EXT['.docx']) {
    return cleanText(extractDocxText(buffer));
  }
  if (ext === '.pdf' || mime === MIME_BY_EXT['.pdf'] || buffer.subarray(0, 5).toString() === '%PDF-') {
    const out = await extractPdfText(buffer);
    const cleaned = cleanText(out);
    if (cleaned.replace(/\s/g, '').length < 60) {
      throw new Error('这个 PDF 像是扫描件，没能提取到文字。请上传 DOCX，或直接把简历文字粘贴进来。');
    }
    return cleaned;
  }
  if (ext === '.txt' || ext === '.md' || mime.startsWith('text/')) {
    return cleanText(buffer.toString('utf8'));
  }
  if (ext === '.doc') {
    throw new Error('暂不支持旧版 .doc，请另存为 .docx 后上传');
  }
  // 兜底：尝试按纯文本读取
  const guess = cleanText(buffer.toString('utf8'));
  if (guess.length > 40) return guess;
  throw new Error('不支持的文件格式，请上传 PDF / DOCX / TXT / MD');
}
