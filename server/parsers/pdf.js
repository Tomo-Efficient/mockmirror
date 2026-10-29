import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function extractPdfText(buffer) {
  const task = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0
  });
  const doc = await task.promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) { out += `${line.trim()}\n`; line = ''; }
      else if (item.str && !item.str.endsWith(' ')) line += '';
    }
    if (line.trim()) out += `${line.trim()}\n`;
    out += '\n';
    page.cleanup();
  }
  await doc.destroy();
  return out;
}
