import { neon } from '@neondatabase/serverless';
import { DATABASE_URL } from './config.js';

let sql = null;
if (DATABASE_URL) {
  try {
    sql = neon(DATABASE_URL);
  } catch (err) {
    console.warn('[db] Neon client 初始化失败:', err.message);
  }
}

export { sql };
export const dbEnabled = Boolean(sql);
