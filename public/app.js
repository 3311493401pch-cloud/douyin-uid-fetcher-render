const shareInput = document.querySelector('#shareInput');
const nameInput = document.querySelector('#nameInput');
const parseButton = document.querySelector('#parseButton');
const clearButton = document.querySelector('#clearButton');
const fillExampleButton = document.querySelector('#fillExampleButton');
const copyAllButton = document.querySelector('#copyAllButton');
const copyPreview = document.querySelector('#copyPreview');
const message = document.querySelector('#message');
const resultPanel = document.querySelector('#resultPanel');
const resultGrid = document.querySelector('#resultGrid');

const exampleText = '8.28 复制打开抖音，看看【声声的图文作品】打卡day1 # 抖音学习充能计划 今天跟着夜雨 ... https://v.douyin.com/VSrlMSTA1FM/ gbA:/ :2pm 03/03 X@M.Ji';
const COOKIE_NAME = 'douyin_nickname';
const COOKIE_DAYS = 365;

let lastParsedData = null;

// --- Cookie helpers ---

function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 86400000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

// --- Init: load saved name ---

(function init() {
  const saved = getCookie(COOKIE_NAME);
  if (saved) {
    nameInput.value = saved;
  }
})();

// Save name on change
nameInput.addEventListener('change', () => {
  const val = nameInput.value.trim();
  if (val) {
    setCookie(COOKIE_NAME, val, COOKIE_DAYS);
  }
});

// --- Date helper (Shanghai UTC+8) ---

function getShanghaiDateString() {
  const now = new Date();
  const SHANGHAI_OFFSET_MIN = 480; // UTC+8
  const localOffsetMin = now.getTimezoneOffset();
  const shanghaiMs = now.getTime() + (SHANGHAI_OFFSET_MIN - localOffsetMin) * 60000;
  const s = new Date(shanghaiMs);
  return `${s.getUTCMonth() + 1}.${s.getUTCDate()}`;
}

// --- Build copy row ---

function buildCopyRow(data) {
  const cols = [
    getShanghaiDateString(),                                    // 1. 日期
    nameInput.value.trim() || '(未填名称)',                      // 2. 抖音名称
    data.authorUid || '',                                       // 3. 作者 UID
    '1w以下',                                                   // 4. 粉丝量级
    '#抖音学习充能企划',                                         // 5. 活动话题
    data.videoUid || '',                                        // 6. 视频 UID
    data.shareUrl || ''                                         // 7. 分享链接
  ];
  return cols.join('\t');
}

// --- Event bindings ---

fillExampleButton.addEventListener('click', () => {
  shareInput.value = exampleText;
  shareInput.focus();
});

clearButton.addEventListener('click', () => {
  shareInput.value = '';
  lastParsedData = null;
  resultPanel.classList.add('hidden');
  copyPreview.textContent = '';
  copyAllButton.disabled = true;
  hideMessage();
  shareInput.focus();
});

parseButton.addEventListener('click', parseInput);
shareInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    parseInput();
  }
});

copyAllButton.addEventListener('click', async () => {
  if (!lastParsedData) return;
  const row = buildCopyRow(lastParsedData);
  try {
    await navigator.clipboard.writeText(row);
    copyAllButton.textContent = '✅ 已复制！';
    window.setTimeout(() => {
      copyAllButton.textContent = '📋 一键复制整行';
    }, 1500);
  } catch {
    showMessage('复制失败，请手动选中文字复制。', 'error');
  }
});

// --- Parse ---

async function parseInput() {
  const input = shareInput.value.trim();

  if (!input) {
    showMessage('请先粘贴抖音分享文本或链接。', 'error');
    return;
  }

  // Client-side quick check
  if (!/[dD]ouyin\.com/i.test(input) && !/iesdouyin\.com/i.test(input)) {
    showMessage('请输入有效的抖音分享链接（包含 douyin.com 或 v.douyin.com）。', 'error');
    return;
  }

  setLoading(true);
  resultPanel.classList.add('hidden');
  showMessage('正在解析短链并获取页面信息，请稍候...', 'info');

  try {
    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input })
    });

    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '解析失败');
    }

    lastParsedData = payload.data;
    renderResult(payload.data);
    showMessage(payload.data.found ? '解析完成，点击「一键复制整行」即可复制。' : '已完成跳转解析，但没有找到明确的 UID 字段。', payload.data.found ? 'success' : 'info');
  } catch (error) {
    showMessage(error.message || '解析失败，请检查链接是否有效。', 'error');
  } finally {
    setLoading(false);
  }
}

// --- Render ---

function renderResult(data) {
  resultGrid.innerHTML = '';

  const fields = [
    { key: 'authorUid', label: '作者 UID' },
    { key: 'videoUid', label: '视频 UID' },
    { key: 'shareUrl', label: '分享链接', full: true }
  ];

  for (const field of fields) {
    resultGrid.appendChild(createResultCard(field.label, data[field.key], field.full));
  }

  // Update preview
  const row = buildCopyRow(data);
  copyPreview.textContent = row;
  copyAllButton.disabled = false;

  resultPanel.classList.remove('hidden');
}

function createResultCard(label, value, full) {
  const card = document.createElement('article');
  card.className = `result-card${full ? ' full' : ''}`;

  const labelEl = document.createElement('div');
  labelEl.className = 'result-label';
  labelEl.textContent = label;

  const row = document.createElement('div');
  row.className = 'result-value-row';

  const valueEl = document.createElement('div');
  valueEl.className = `result-value${value ? '' : ' empty'}`;
  valueEl.textContent = value || '未获取到';

  const copyButton = document.createElement('button');
  copyButton.className = 'copy-button';
  copyButton.type = 'button';
  copyButton.textContent = '复制';
  copyButton.disabled = !value;
  copyButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(value);
    copyButton.textContent = '已复制';
    window.setTimeout(() => {
      copyButton.textContent = '复制';
    }, 1200);
  });

  row.append(valueEl, copyButton);
  card.append(labelEl, row);
  return card;
}

// --- UI helpers ---

function setLoading(isLoading) {
  parseButton.disabled = isLoading;
  parseButton.textContent = isLoading ? '获取中...' : '开始获取';
}

function showMessage(text, type) {
  message.textContent = text;
  message.className = `message ${type}`;
}

function hideMessage() {
  message.className = 'message hidden';
  message.textContent = '';
}
