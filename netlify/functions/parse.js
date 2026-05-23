const { parseDouyinInput } = require('../../lib/douyinParser');

exports.handler = async (event) => {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: '不支持的请求方法' })
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const input = String(payload.input || payload.url || '').trim();

    if (!input) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ ok: false, error: '请粘贴抖音分享文本或链接' })
      };
    }

    const result = toPublicResult(await parseDouyinInput(input));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, data: result })
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      headers,
      body: JSON.stringify({ ok: false, error: error.message || '服务器内部错误' })
    };
  }
};

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
