import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { studioError } from './studio-store.js';

export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    isIP(address) === 6 &&
    /^[23]/i.test(address) &&
    !/^2001:(db8|0):/i.test(address) &&
    !/^2002:/i.test(address)
  );
}
export function pageSlice(text, options = {}) {
  const offset = options.offset ?? 0;
  const length = options.length ?? 24000;
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(length) ||
    length < 1 ||
    length > 24000
  )
    throw studioError('网页读取 offset 须为非负整数，length 须为1至24000的整数');
  return {
    text: text.slice(offset, offset + length),
    offset,
    totalCharacters: text.length,
    hasMore: offset + length < text.length,
    truncated: offset > 0 || offset + length < text.length,
  };
}
export async function publicPage(url, signal, hops = 0, options = {}) {
  pageSlice('', options);
  let target;
  try {
    target = new URL(url);
  } catch {
    throw studioError('网页地址无效');
  }
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    (target.port && target.port !== '443')
  )
    throw studioError('只支持公开 HTTPS 网页');
  const addresses = await lookup(target.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || addresses.some((x) => !publicAddress(x.address)))
    throw studioError('不能读取本机或内部网络地址');
  const selected = addresses.find((address) => address.family === 4) || addresses[0];
  const result = await new Promise((resolve, reject) => {
    const req = https.get(
      target,
      {
        signal,
        autoSelectFamily: true,
        headers: {
          Accept: 'text/html,text/plain,application/json',
          'Accept-Encoding': 'identity',
          'User-Agent': 'ResearchWorkspace/1.0',
        },
        lookup: (_host, options, cb) =>
          options.all ? cb(null, addresses) : cb(null, selected.address, selected.family),
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          resolve({ redirect: res.headers.location });
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(studioError(`网页返回 HTTP ${res.statusCode}`, 502));
          return;
        }
        if (!/text\/|application\/json/.test(res.headers['content-type'] || '')) {
          res.resume();
          reject(studioError('此链接不是可读取的文本网页，请上传对应文件'));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) req.destroy(studioError('网页超过2 MB读取上限'));
          else chunks.push(chunk);
        });
        res.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.setTimeout(20000, () => req.destroy(studioError('网页读取超时', 502)));
    req.on('error', reject);
  });
  if (result.redirect) {
    if (hops >= 3) throw studioError('网页重定向过多');
    return publicPage(new URL(result.redirect, target).href, signal, hops + 1, options);
  }
  const text = result.text
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text)
    throw studioError('网页没有可读取的文字，可能需要登录或执行脚本；请换用公开正文链接', 502);
  return {
    url: target.href,
    retrievedAt: new Date().toISOString(),
    ...pageSlice(text, options),
  };
}

export function createStudioWeb(db, directory, models) {
  db.exec('CREATE TABLE IF NOT EXISTS studio_web (ws TEXT PRIMARY KEY, secret TEXT NOT NULL)');
  const master = readFileSync(path.join(directory, '.model-encryption-key'));
  const secret = (ws) => db.prepare('SELECT secret FROM studio_web WHERE ws=?').get(ws)?.secret;
  const key = (ws) => {
    const encrypted = secret(ws);
    if (!encrypted) return process.env.BRAVE_SEARCH_API_KEY || '';
    const bytes = Buffer.from(encrypted, 'base64'),
      cipher = createDecipheriv('aes-256-gcm', master, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8');
  };
  return {
    status(ws, config = models?.get(ws)) {
      const deepseek = Boolean(models?.supportsWebSearch(config));
      const brave = Boolean(secret(ws) || process.env.BRAVE_SEARCH_API_KEY);
      return {
        provider: deepseek ? 'DeepSeek Search' : brave ? 'Brave Search' : '',
        configured: deepseek || brave,
        deepseek,
        braveConfigured: brave,
        braveSaved: Boolean(secret(ws)),
        environment: Boolean(process.env.BRAVE_SEARCH_API_KEY),
        pageReading: true,
        literature: true,
      };
    },
    save(ws, input) {
      if (input.remove) {
        db.prepare('DELETE FROM studio_web WHERE ws=?').run(ws);
        return this.status(ws);
      }
      if (
        typeof input.apiKey !== 'string' ||
        !input.apiKey.trim() ||
        input.apiKey.length > 4096 ||
        /[\r\n]/.test(input.apiKey)
      )
        throw studioError('请输入有效的搜索 API Key');
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', master, iv);
      const encrypted = Buffer.concat([
        iv,
        cipher.update(input.apiKey.trim(), 'utf8'),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString('base64');
      db.prepare('INSERT OR REPLACE INTO studio_web VALUES (?,?)').run(ws, encrypted);
      return this.status(ws);
    },
    async search(ws, query, signal, config = models?.get(ws)) {
      if (typeof query !== 'string' || !query.trim() || query.length > 600)
        throw studioError('搜索词须为1至600个字符');
      if (models?.supportsWebSearch(config)) {
        const rows = await models.searchWeb(config, query, signal);
        const text = (value, limit) => (typeof value === 'string' ? value.slice(0, limit) : '');
        return {
          provider: 'DeepSeek Search',
          query: query.trim(),
          retrievedAt: new Date().toISOString(),
          results: rows
            .filter((row) => {
              try {
                const url = new URL(row?.url);
                return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
              } catch {
                return false;
              }
            })
            .slice(0, 6)
            .map((row) => ({
              title: text(row.title, 300),
              url: text(row.url, 8192),
              description: text(row.snippet, 1200),
              summary: text(row.summary, 2400),
              content: text(row.content, 6000),
              contentTruncated: typeof row.content === 'string' && row.content.length > 6000,
              publishedAt: text(row.date, 80) || null,
            })),
          limits:
            '搜索结果与正文片段不等于已核验全文；投稿分区须核对口径、年份和学科，结论须引用实际返回的来源链接。',
        };
      }
      const apiKey = key(ws);
      if (!apiKey)
        throw studioError(
          '尚未配置网页搜索服务。请启用官方 DeepSeek 模型连接，或在联网设置填写 Brave Search API Key；已有链接仍可直接读取。',
          409,
        );
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`,
        {
          signal: AbortSignal.any([
            signal || new AbortController().signal,
            AbortSignal.timeout(20000),
          ]),
          redirect: 'error',
          headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
        },
      );
      if (!res.ok)
        throw studioError(`网页搜索失败（HTTP ${res.status}），请检查搜索密钥或额度`, 502);
      const raw = await res.text();
      if (raw.length > 2 * 1024 * 1024) throw studioError('搜索响应过大', 502);
      const data = JSON.parse(raw);
      return {
        provider: 'Brave Search',
        query,
        retrievedAt: new Date().toISOString(),
        results: (data.web?.results || [])
          .slice(0, 6)
          .map((x) => ({ title: x.title, url: x.url, description: x.description })),
        limits: '搜索摘要不等于全文或官方核验；投稿分区需核对口径、年份和学科。',
      };
    },
    read: (url, signal, options) => publicPage(url, signal, 0, options),
  };
}
