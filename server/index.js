import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, HOST, PUBLIC_DIR, LIMITS, DATA_DIR } from './config.js';
import {
  initStore, store, allKb, addResume, getResume,
  getSession, deleteSession, listSessions, stats, publicSettings, updateSettings,
  addBankItem, updateBankItem, deleteBankItem, addCustomKb, deleteCustomKb, save,
  flushStore, storageMode
} from './store.js';
import { parseUpload } from './parsers/index.js';
import { parseResume } from './profile.js';
import { analyzeJD } from './jd.js';
import { search, invalidateIndex } from './rag.js';
import { testConnection, isLLMEnabled } from './llm.js';
import { createSession, streamTurn, getHint, skipQuestion, finishSession, publicSession } from './agent/conversation.js';
import { NODE_META } from './agent/graph.js';

await initStore();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
};

const sendError = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[api]', err);
  json(res, status, { error: err.message || '服务异常' });
};

async function readJson(req, limit = LIMITS.bodyBytes) {
  const type = req.headers['content-type'] || '';
  if (!type.includes('application/json')) throw new HttpError(415, '请使用 application/json 提交');
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > limit) {
    req.resume();
    throw new HttpError(413, '文件过大，请控制在 10MB 以内');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new HttpError(413, '文件过大，请控制在 10MB 以内');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON');
  }
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(PUBLIC_DIR, `.${rel}`);
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
    return json(res, 403, { error: '禁止访问' });
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(file)) return json(res, 404, { error: 'Not found' });
    return serveStatic(req, res, '/index.html');
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  fs.createReadStream(file).pipe(res);
}

function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function route(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (pathname === '/api/health') {
    return json(res, 200, { ok: true, version: '1.0.0', llm: isLLMEnabled(), storage: storageMode(), time: new Date().toISOString() });
  }

  if (pathname === '/api/bootstrap' && method === 'GET') {
    return json(res, 200, {
      personas: store.personas.length ? store.personas : undefined,
      roles: store.roles.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, keywords: r.keywords, summary: r.summary, competencies: r.competencies, focusTopics: r.focusTopics })),
      categories: [...new Set(allKb().map((d) => d.category))],
      stats: stats(),
      settings: publicSettings(),
      nodes: NODE_META,
      llm: { enabled: isLLMEnabled() }
    });
  }

  if (pathname === '/api/demo' && method === 'GET') {
    const file = path.join(DATA_DIR, 'demo.json');
    if (fs.existsSync(file)) return json(res, 200, JSON.parse(fs.readFileSync(file, 'utf8')));
    return json(res, 404, { error: '示例数据未准备好' });
  }

  if (pathname === '/api/settings' && method === 'GET') return json(res, 200, publicSettings());
  if (pathname === '/api/settings' && method === 'PUT') {
    const body = await readJson(req);
    if (body.llm) {
      const base = String(body.llm.baseUrl || '').trim();
      if (base && !/^https?:\/\//i.test(base)) throw new HttpError(400, 'Base URL 必须以 http(s):// 开头');
      if (body.llm.model && String(body.llm.model).length > 80) throw new HttpError(400, '模型名称过长');
    }
    return json(res, 200, updateSettings(body));
  }
  if (pathname === '/api/settings/test' && method === 'POST') {
    if (!isLLMEnabled()) throw new HttpError(400, '请先填写并保存 API Key，并开启模型');
    const result = await testConnection();
    return json(res, 200, result);
  }

  if (pathname === '/api/resume/parse' && method === 'POST') {
    const body = await readJson(req);
    let buffer = null;
    if (body.dataBase64) {
      const raw = String(body.dataBase64).replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(raw, 'base64');
    }
    let text;
    try {
      text = await parseUpload({ filename: body.filename || '', mime: body.mime || '', buffer, text: body.text || '' });
    } catch (err) {
      throw new HttpError(400, err.message || '文件解析失败，请检查格式后重试');
    }
    if (text.replace(/\s/g, '').length < 80) throw new HttpError(400, '识别到的文字太少，请上传完整简历或直接粘贴文字');
    const profile = parseResume(text, { filename: body.filename || '粘贴的简历' });
    const resume = addResume({ filename: body.filename || '粘贴的简历', text, profile, quality: profile.quality });
    return json(res, 200, {
      resumeId: resume.id,
      text: resume.text.slice(0, LIMITS.resumeChars),
      profile: resume.profile,
      quality: resume.quality
    });
  }

  if (pathname.startsWith('/api/resume/') && method === 'PATCH') {
    const id = pathname.split('/')[3];
    const resume = getResume(id);
    if (!resume) throw new HttpError(404, '简历不存在');
    const body = await readJson(req);
    const allowed = ['name', 'headline', 'summary', 'skills', 'keywords', 'targetRoles'];
    for (const key of allowed) {
      if (body[key] !== undefined) resume.profile[key] = body[key];
    }
    resume.profile.updatedAt = new Date().toISOString();
    save();
    return json(res, 200, { resumeId: id, profile: resume.profile });
  }

  if (pathname === '/api/jd/analyze' && method === 'POST') {
    const body = await readJson(req);
    const jdText = String(body.jdText || '').slice(0, LIMITS.jdChars);
    if (jdText.trim().length < 20) throw new HttpError(400, 'JD 太短，至少粘贴 20 个字');
    const resume = getResume(body.resumeId);
    if (!resume) throw new HttpError(404, '请先上传简历');
    const analysis = analyzeJD({ jdText, profile: resume.profile });
    return json(res, 200, analysis);
  }

  if (pathname === '/api/sessions' && method === 'POST') {
    const body = await readJson(req);
    const resume = getResume(body.resumeId);
    if (!resume) throw new HttpError(404, '请先上传并解析简历');
    const jdText = String(body.jdText || '').slice(0, LIMITS.jdChars);
    if (jdText.trim().length < 20) throw new HttpError(400, '请先粘贴目标岗位 JD');
    const session = await createSession({ resume, jdText, config: body.config || {} });
    return json(res, 200, session);
  }
  if (pathname === '/api/sessions' && method === 'GET') {
    return json(res, 200, { sessions: listSessions() });
  }
  if (pathname === '/api/stats' && method === 'GET') return json(res, 200, stats());

  const sessionMatch = pathname.match(/^\/api\/sessions\/([\w-]+)$/);
  if (sessionMatch) {
    const session = getSession(sessionMatch[1]);
    if (!session) throw new HttpError(404, '面试记录不存在');
    if (method === 'GET') return json(res, 200, publicSession(session));
    if (method === 'DELETE') { deleteSession(session.id); return json(res, 200, { ok: true }); }
  }

  const turnMatch = pathname.match(/^\/api\/sessions\/([\w-]+)\/turn$/);
  if (turnMatch && method === 'POST') {
    const session = getSession(turnMatch[1]);
    if (!session) throw new HttpError(404, '面试记录不存在');
    const body = await readJson(req);
    sseInit(res);
    try {
      for await (const event of streamTurn(session, body.text)) {
        if (res.writableEnded) break;
        sseSend(res, event.type, event);
      }
      sseSend(res, 'done', { ok: true });
    } catch (err) {
      if (!res.writableEnded) sseSend(res, 'error', { message: err.message });
    } finally {
      if (!res.writableEnded) res.end();
    }
    return;
  }

  const actionMatch = pathname.match(/^\/api\/sessions\/([\w-]+)\/(hint|skip|report)$/);
  if (actionMatch && method === 'POST') {
    const session = getSession(actionMatch[1]);
    if (!session) throw new HttpError(404, '面试记录不存在');
    if (actionMatch[2] !== 'report' && session.status !== 'active') throw new HttpError(400, '本场面试已经结束');
    if (actionMatch[2] === 'hint') return json(res, 200, getHint(session));
    if (actionMatch[2] === 'skip') return json(res, 200, skipQuestion(session));
    return json(res, 200, await finishSession(session, { force: url.searchParams.get('force') === '1' }));
  }

  if (pathname === '/api/bank' && method === 'GET') {
    return json(res, 200, { items: store.bank });
  }
  if (pathname === '/api/bank' && method === 'POST') {
    const body = await readJson(req);
    if (!body.question || String(body.question).trim().length < 6) throw new HttpError(400, '题目内容太短');
    const item = addBankItem({
      question: String(body.question).slice(0, 500),
      category: body.category,
      tags: body.tags,
      source: body.source,
      sessionId: body.sessionId
    });
    return json(res, 200, { item });
  }
  if (pathname.startsWith('/api/bank/')) {
    const id = pathname.split('/')[3];
    if (method === 'PATCH') {
      const body = await readJson(req);
      const item = updateBankItem(id, body);
      if (!item) throw new HttpError(404, '题目不存在');
      return json(res, 200, { item });
    }
    if (method === 'DELETE') {
      if (!deleteBankItem(id)) throw new HttpError(404, '题目不存在');
      return json(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/kb' && method === 'GET') {
    const category = url.searchParams.get('category') || '';
    const q = (url.searchParams.get('q') || '').trim();
    if (q) {
      return json(res, 200, { items: search(q, { topK: 12, types: ['kb'] }), query: q });
    }
    const items = allKb()
      .filter((d) => !category || d.category === category)
      .map((d) => ({ id: d.id, title: d.title, category: d.category, tags: d.tags, summary: d.summary, source: d.source, readingMinutes: d.readingMinutes, custom: d.custom }));
    return json(res, 200, { items });
  }
  if (pathname === '/api/kb' && method === 'POST') {
    const body = await readJson(req);
    if (!body.title || !body.content || String(body.content).length < 80) throw new HttpError(400, '标题和正文不能为空，正文至少 80 字');
    const doc = addCustomKb({
      title: String(body.title).slice(0, 120),
      category: body.category || '我的资料',
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 8) : [],
      summary: String(body.summary || body.content).slice(0, 120),
      content: String(body.content).slice(0, 20000),
      readingMinutes: Math.max(1, Math.round(String(body.content).length / 500))
    });
    invalidateIndex();
    return json(res, 200, { item: doc });
  }
  if (pathname.startsWith('/api/kb/') && method === 'GET') {
    const id = pathname.split('/')[3];
    const doc = allKb().find((d) => d.id === id);
    if (!doc) throw new HttpError(404, '文档不存在');
    return json(res, 200, { item: doc });
  }
  if (pathname.startsWith('/api/kb/') && method === 'DELETE') {
    const id = pathname.split('/')[3];
    if (!deleteCustomKb(id)) throw new HttpError(400, '内置知识库不可删除');
    invalidateIndex();
    return json(res, 200, { ok: true });
  }

  throw new HttpError(404, '接口不存在');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await route(req, res, url);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (err) {
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    sendError(res, err);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 已被占用。\n  请先关闭占用该端口的进程，或用 PORT=4319 npm start 换一个端口。\n`);
    process.exit(1);
  }
  throw err;
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    await flushStore();
    process.exit(0);
  });
}

server.listen(PORT, HOST, () => {
  console.log(`\n  面镜 MockMirror 已启动`);
  console.log(`  → http://${HOST}:${PORT}\n`);
});
