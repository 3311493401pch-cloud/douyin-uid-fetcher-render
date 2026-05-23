const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const PORT_RETRY_LIMIT = 20;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_SIZE = 1024 * 1024;
const REDIRECT_LIMIT = 10;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

const requestHeaders = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'cache-control': 'no-cache',
  pragma: 'no-cache'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'POST' && url.pathname === '/api/parse') {
      await handleParse(req, res);
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 405, { ok: false, error: '不支持的请求方法' });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || '服务器内部错误' });
  }
});

startServer(PORT);

async function handleParse(req, res) {
  const body = await readRequestBody(req);
  let payload;

  try {
    payload = JSON.parse(body || '{}');
  } catch {
    sendJson(res, 400, { ok: false, error: '请求体不是有效的 JSON' });
    return;
  }

  const input = String(payload.input || payload.url || '').trim();

  if (!input) {
    sendJson(res, 400, { ok: false, error: '请粘贴抖音分享文本或链接' });
    return;
  }

  const result = await parseDouyinInput(input);
  sendJson(res, 200, { ok: true, data: toPublicResult(result) });
}

function toPublicResult(result) {
  const authorUid = result.authorUid || '';
  const videoUid = result.videoUid || result.awemeId || '';

  return {
    authorUid,
    videoUid,
    shareUrl: result.shareUrl || '',
    found: Boolean(authorUid || videoUid)
  };
}

async function parseDouyinInput(input) {
  const shareUrl = extractFirstUrl(input);

  if (!shareUrl) {
    const error = new Error('没有在输入内容中找到有效链接');
    error.statusCode = 400;
    throw error;
  }

  const resolved = await fetchWithRedirects(shareUrl);
  const parsed = extractDouyinIds({ input, shareUrl, finalUrl: resolved.finalUrl, redirectHistory: resolved.history, html: resolved.body });

  return {
    input,
    shareUrl,
    finalUrl: resolved.finalUrl,
    httpStatus: resolved.status,
    redirectHistory: resolved.history,
    ...parsed
  };
}

async function fetchWithRedirects(startUrl) {
  let currentUrl = startUrl;
  const history = [];

  for (let index = 0; index < REDIRECT_LIMIT; index += 1) {
    const response = await fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: requestHeaders
    });

    const location = response.headers.get('location');
    history.push({ url: currentUrl, status: response.status, location: location ? new URL(location, currentUrl).href : '' });

    if (response.status >= 300 && response.status < 400 && location) {
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    const body = await response.text();
    const scriptRedirect = findScriptRedirect(body, currentUrl);

    if (scriptRedirect && scriptRedirect !== currentUrl) {
      currentUrl = scriptRedirect;
      continue;
    }

    return {
      finalUrl: currentUrl,
      status: response.status,
      body,
      history
    };
  }

  const error = new Error('短链跳转次数过多，无法继续解析');
  error.statusCode = 400;
  throw error;
}

function extractDouyinIds({ input, shareUrl, finalUrl, redirectHistory, html }) {
  const candidates = {
    videoIds: [],
    authorUids: [],
    secUids: [],
    uniqueIds: [],
    shortIds: [],
    nicknames: []
  };

  collectFromUrl(finalUrl, candidates);
  collectFromUrl(shareUrl, candidates);

  for (const item of redirectHistory || []) {
    collectFromUrl(item.url, candidates);
    collectFromUrl(item.location, candidates);
  }

  collectFromHtml(html || '', candidates);

  const nicknameFromInput = extractNicknameFromShareText(input);
  if (nicknameFromInput) {
    addCandidate(candidates.nicknames, nicknameFromInput, 'share_text');
  }

  const videoUid = firstValue(candidates.videoIds);
  const authorUid = selectAuthorUid(candidates.authorUids, videoUid);

  return {
    videoUid,
    awemeId: videoUid,
    authorUid,
    userUid: authorUid,
    secUid: firstValue(candidates.secUids),
    uniqueId: firstValue(candidates.uniqueIds),
    shortId: firstValue(candidates.shortIds),
    nickname: firstValue(candidates.nicknames),
    candidates,
    found: Boolean(videoUid || authorUid || firstValue(candidates.secUids))
  };
}

function collectFromUrl(rawUrl, candidates) {
  if (!rawUrl) return;

  const patterns = [
    { regex: /\/video\/(\d{8,30})/i, target: candidates.videoIds, source: 'url_video_path' },
    { regex: /\/note\/(\d{8,30})/i, target: candidates.videoIds, source: 'url_note_path' },
    { regex: /\/share\/video\/(\d{8,30})/i, target: candidates.videoIds, source: 'url_share_video_path' },
    { regex: /[?&]aweme_id=(\d{8,30})/i, target: candidates.videoIds, source: 'url_aweme_id' },
    { regex: /[?&]modal_id=(\d{8,30})/i, target: candidates.videoIds, source: 'url_modal_id' },
    { regex: /[?&]item_ids=(\d{8,30})/i, target: candidates.videoIds, source: 'url_item_ids' },
    { regex: /[?&]sec_uid=([^&#]+)/i, target: candidates.secUids, source: 'url_sec_uid' },
    { regex: /[?&]uid=(\d{5,30})/i, target: candidates.authorUids, source: 'url_uid' }
  ];

  for (const item of patterns) {
    const match = rawUrl.match(item.regex);
    if (match) addCandidate(item.target, decodeURIComponentSafe(match[1]), item.source);
  }

  collectFromUrlQueryParams(rawUrl, candidates);
}

function collectFromUrlQueryParams(rawUrl, candidates) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }

  for (const [key, value] of url.searchParams.entries()) {
    const keyLower = key.toLowerCase();
    const decodedValue = decodeURIComponentSafe(value);
    const source = `url_param_${key}`;

    if (!decodedValue) continue;

    if (['uid', 'user_id', 'userid', 'author_id', 'authorid', 'author_user_id', 'authoruserid', 'social_author_id', 'socialauthorid', 'social_share_user_id', 'socialshareuserid'].includes(keyLower) && /^\d{5,30}$/.test(decodedValue)) {
      addCandidate(candidates.authorUids, decodedValue, source);
    }

    if (['aweme_id', 'awemeid', 'item_id', 'itemid', 'modal_id', 'modalid', 'item_ids', 'itemids'].includes(keyLower) && /^\d{8,30}$/.test(decodedValue)) {
      addCandidate(candidates.videoIds, decodedValue, source);
    }

    if (['sec_uid', 'secuid'].includes(keyLower)) {
      addCandidate(candidates.secUids, decodedValue, source);
    }

    const data = parseJsonText(decodedValue);
    if (data) {
      collectFromObject(data, candidates, [source]);
    }

    const socialShareMatch = decodedValue.match(/^(\d{5,30})_\d{8,30}$/);
    if (['social_share_id', 'socialshareid'].includes(keyLower) && socialShareMatch) {
      addCandidate(candidates.authorUids, socialShareMatch[1], source);
    }
  }
}

function collectFromHtml(html, candidates) {
  if (!html) return;

  collectByRegex(html, candidates);

  for (const jsonText of extractJsonTexts(html)) {
    const data = parseJsonText(jsonText);
    if (data) collectFromObject(data, candidates);
  }
}

function collectByRegex(html, candidates) {
  const patterns = [
    { regex: /"aweme_id"\s*:\s*"(\d{8,30})"/g, target: candidates.videoIds, source: 'html_aweme_id' },
    { regex: /"awemeId"\s*:\s*"(\d{8,30})"/g, target: candidates.videoIds, source: 'html_awemeId' },
    { regex: /"itemId"\s*:\s*"(\d{8,30})"/g, target: candidates.videoIds, source: 'html_itemId' },
    { regex: /"group_id"\s*:\s*"(\d{8,30})"/g, target: candidates.videoIds, source: 'html_group_id' },
    { regex: /"sec_uid"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, target: candidates.secUids, source: 'html_sec_uid' },
    { regex: /"secUid"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, target: candidates.secUids, source: 'html_secUid' },
    { regex: /"uid"\s*:\s*"(\d{5,30})"/g, target: candidates.authorUids, source: 'html_uid' },
    { regex: /"user_id"\s*:\s*"(\d{5,30})"/g, target: candidates.authorUids, source: 'html_user_id' },
    { regex: /"userId"\s*:\s*"(\d{5,30})"/g, target: candidates.authorUids, source: 'html_userId' },
    { regex: /"unique_id"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, target: candidates.uniqueIds, source: 'html_unique_id' },
    { regex: /"uniqueId"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, target: candidates.uniqueIds, source: 'html_uniqueId' },
    { regex: /"short_id"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, target: candidates.shortIds, source: 'html_short_id' },
    { regex: /"shortId"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, target: candidates.shortIds, source: 'html_shortId' },
    { regex: /"nickname"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, target: candidates.nicknames, source: 'html_nickname' },
    { regex: /"nickName"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, target: candidates.nicknames, source: 'html_nickName' }
  ];

  for (const item of patterns) {
    let match;
    while ((match = item.regex.exec(html)) !== null) {
      addCandidate(item.target, decodeJsonString(match[1]), item.source);
    }
  }
}

function extractJsonTexts(html) {
  const texts = [];
  const scriptPattern = /<script\b[^>]*(?:id=["'](?:RENDER_DATA|SIGI_STATE|UNIVERSAL_DATA_FOR_REHYDRATION)["'])[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;

  while ((scriptMatch = scriptPattern.exec(html)) !== null) {
    texts.push(decodeHtmlEntities(scriptMatch[1].trim()));
  }

  const markers = [
    'window.__INITIAL_STATE__',
    'window._ROUTER_DATA',
    'window.__ROUTER_DATA__',
    'window.__UNIVERSAL_DATA_FOR_REHYDRATION__',
    'window.__douyin_share_data__'
  ];

  for (const marker of markers) {
    const jsonText = extractJsonAfterMarker(html, marker);
    if (jsonText) texts.push(jsonText);
  }

  return texts;
}

function extractJsonAfterMarker(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return '';

  const equalIndex = text.indexOf('=', markerIndex);
  if (equalIndex < 0) return '';

  const start = text.indexOf('{', equalIndex);
  if (start < 0) return '';

  return readBalancedJson(text, start);
}

function readBalancedJson(text, start) {
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) return text.slice(start, index + 1);
  }

  return '';
}

function parseJsonText(text) {
  if (!text) return null;

  const variants = [text, decodeURIComponentSafe(text), decodeHtmlEntities(text)];

  for (const variant of variants) {
    const trimmed = variant.trim();
    if (!trimmed) continue;

    try {
      return JSON.parse(trimmed);
    } catch {}
  }

  return null;
}

function collectFromObject(value, candidates, pathParts = []) {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectFromObject(value[index], candidates, pathParts.concat(String(index)));
    }
    return;
  }

  if (typeof value !== 'object') return;

  for (const [key, entry] of Object.entries(value)) {
    const keyLower = key.toLowerCase();
    const entryValue = normalizeValue(entry);
    const source = `json_${pathParts.concat(key).join('.')}`;

    if (entryValue) {
      if (['aweme_id', 'awemeid', 'item_id', 'itemid', 'group_id', 'groupid'].includes(keyLower) && /^\d{8,30}$/.test(entryValue)) {
        addCandidate(candidates.videoIds, entryValue, source);
      }

      if (['uid', 'user_id', 'userid', 'author_id', 'authorid', 'author_user_id', 'authoruserid', 'social_author_id', 'socialauthorid', 'social_share_user_id', 'socialshareuserid'].includes(keyLower) && /^\d{5,30}$/.test(entryValue)) {
        addCandidate(candidates.authorUids, entryValue, source);
      }

      if (['social_share_id', 'socialshareid'].includes(keyLower)) {
        const socialShareMatch = entryValue.match(/^(\d{5,30})_\d{8,30}$/);
        if (socialShareMatch) addCandidate(candidates.authorUids, socialShareMatch[1], source);
      }

      if (['sec_uid', 'secuid'].includes(keyLower)) {
        addCandidate(candidates.secUids, entryValue, source);
      }

      if (['unique_id', 'uniqueid'].includes(keyLower)) {
        addCandidate(candidates.uniqueIds, entryValue, source);
      }

      if (['short_id', 'shortid'].includes(keyLower)) {
        addCandidate(candidates.shortIds, entryValue, source);
      }

      if (['nickname', 'nickname', 'nick_name', 'nickname'].includes(keyLower)) {
        addCandidate(candidates.nicknames, entryValue, source);
      }
    }

    collectFromObject(entry, candidates, pathParts.concat(key));
  }
}

function selectAuthorUid(authorUids, videoUid) {
  const list = authorUids.filter((item) => item.value && item.value !== videoUid);
  const preferred = list.find((item) => /author|user|owner|account/i.test(item.source));
  return preferred ? preferred.value : firstValue(list);
}

function addCandidate(list, rawValue, source) {
  const value = String(rawValue || '').trim();
  if (!value || value === '0') return;
  if (list.some((item) => item.value === value)) return;
  list.push({ value, source });
}

function firstValue(list) {
  return Array.isArray(list) && list[0] ? list[0].value : '';
}

function normalizeValue(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  return '';
}

function extractFirstUrl(text) {
  const match = String(text).match(/https?:\/\/[^\s"'<>，。；、]+/i);
  if (!match) return '';

  const url = match[0].replace(/[)\]}>,，。；;！!？?、]+$/g, '');

  try {
    return new URL(url).href;
  } catch {
    return '';
  }
}

function extractNicknameFromShareText(text) {
  const match = String(text).match(/【(.+?)的(?:图文作品|视频|作品|直播|合集)】/);
  return match ? match[1].trim() : '';
}

function findScriptRedirect(html, baseUrl) {
  const patterns = [
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"']+)["']/i,
    /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /location\.replace\(["']([^"']+)["']\)/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        return new URL(decodeHtmlEntities(match[1]), baseUrl).href;
      } catch {}
    }
  }

  return '';
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value;
  }
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#38;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&#60;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#62;/g, '>');
}

async function serveStatic(pathname, res) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const decodedPath = decodeURIComponent(safePath);
  const filePath = path.normalize(path.join(PUBLIC_DIR, decodedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    sendBuffer(res, 200, data, CONTENT_TYPES[ext] || 'application/octet-stream');
  } catch {
    sendText(res, 404, 'Not Found');
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_SIZE) {
        reject(new Error('请求内容过大'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache'
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendBuffer(res, status, buffer, contentType) {
  res.writeHead(status, { 'content-type': contentType });
  res.end(buffer);
}

function startServer(port, retryCount = 0) {
  const onError = (error) => {
    server.removeListener('listening', onListening);

    if (error.code === 'EADDRINUSE' && retryCount < PORT_RETRY_LIMIT) {
      startServer(port + 1, retryCount + 1);
      return;
    }

    throw error;
  };

  const onListening = () => {
    server.removeListener('error', onError);
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Douyin UID 获取网站已启动：http://localhost:${actualPort}`);
  };

  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port);
}
