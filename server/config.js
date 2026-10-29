import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const CONTENT_DIR = path.join(ROOT, 'content');
export const DATA_DIR = path.join(ROOT, 'data');
export const DATA_FILE = path.join(DATA_DIR, 'store.json');

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
loadEnv();

export const PORT = Number(process.env.PORT || 4318);
export const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');

export const ENV_LLM = {
  baseUrl: process.env.LLM_BASE_URL || '',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || '',
  temperature: Number(process.env.LLM_TEMPERATURE || 0.7)
};

export const LIMITS = {
  bodyBytes: 12 * 1024 * 1024,
  resumeChars: 30000,
  jdChars: 6000,
  answerChars: 4000,
  rounds: { min: 3, max: 12 }
};
