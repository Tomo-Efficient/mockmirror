import { store } from './store.js';

export function llmConfig() {
  const { llm } = store.settings;
  return {
    enabled: Boolean(llm.enabled && llm.apiKey && llm.baseUrl && llm.model),
    baseUrl: (llm.baseUrl || '').replace(/\/+$/, ''),
    apiKey: llm.apiKey || '',
    model: llm.model || '',
    temperature: Number.isFinite(llm.temperature) ? llm.temperature : 0.7,
    provider: llm.provider || 'custom'
  };
}

export function isLLMEnabled() {
  return llmConfig().enabled;
}

function endpoint(baseUrl) {
  if (/\/chat\/completions$/.test(baseUrl)) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

function explainError(status, body) {
  const text = String(body || '').slice(0, 300);
  if (status === 401 || status === 403) return 'API Key 无效或没有权限，请到设置页检查';
  if (status === 404) return '模型或接口地址不存在，请检查 Base URL 与模型名称';
  if (status === 429) return '请求过于频繁或额度不足，请稍后再试';
  if (status >= 500) return '模型服务暂时不可用，请稍后重试';
  return `模型调用失败（${status}）：${text}`;
}

async function request(payload, { signal, timeout = 90000 } = {}) {
  const cfg = llmConfig();
  if (!cfg.enabled) throw new Error('尚未配置模型');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(endpoint(cfg.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({ model: cfg.model, ...payload }),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(explainError(res.status, text));
      err.status = res.status;
      throw err;
    }
    return res;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('模型响应超时，请稍后重试或切换本地模式');
    if (err instanceof TypeError || /fetch failed/i.test(err.message)) {
      throw new Error('无法连接到模型服务，请检查 Base URL、网络或代理设置');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export async function chat(messages, { json = false, temperature, maxTokens = 1200, signal } = {}) {
  const cfg = llmConfig();
  const base = {
    messages,
    temperature: temperature ?? cfg.temperature,
    max_tokens: maxTokens,
    stream: false
  };
  let res;
  try {
    res = await request(json ? { ...base, response_format: { type: 'json_object' } } : base, { signal });
  } catch (err) {
    if (json && err.status === 400) {
      res = await request(base, { signal });
    } else {
      throw err;
    }
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型返回为空');
  return content.trim();
}

export async function* streamChat(messages, { temperature, maxTokens = 800, signal } = {}) {
  const cfg = llmConfig();
  const res = await request({
    messages,
    temperature: temperature ?? cfg.temperature,
    max_tokens: maxTokens,
    stream: true
  }, { signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const obj = JSON.parse(data);
        const delta = obj?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // 忽略无法解析的 keep-alive 行
      }
    }
  }
}

export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) return null;
  const endObj = candidate.lastIndexOf('}');
  const endArr = candidate.lastIndexOf(']');
  const end = Math.max(endObj, endArr);
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function testConnection() {
  const started = Date.now();
  const content = await chat([
    { role: 'system', content: '你是一个连通性测试助手，只回复两个字：正常' },
    { role: 'user', content: '请回复“正常”' }
  ], { maxTokens: 20, temperature: 0 });
  return { ok: true, latency: Date.now() - started, reply: content.slice(0, 40), model: llmConfig().model };
}
