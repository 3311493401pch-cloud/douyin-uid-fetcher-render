const shareInput = document.querySelector('#shareInput');
const parseButton = document.querySelector('#parseButton');
const clearButton = document.querySelector('#clearButton');
const fillExampleButton = document.querySelector('#fillExampleButton');
const message = document.querySelector('#message');
const resultPanel = document.querySelector('#resultPanel');
const resultGrid = document.querySelector('#resultGrid');

const exampleText = '8.28 复制打开抖音，看看【声声的图文作品】打卡day1 # 抖音学习充能计划 今天跟着夜雨 ... https://v.douyin.com/VSrlMSTA1FM/ gbA:/ :2pm 03/03 X@M.Ji';

const resultFields = [
  { key: 'authorUid', label: '作者 UID' },
  { key: 'videoUid', label: '当前分享视频 UID' },
  { key: 'shareUrl', label: '当前视频分享链接', full: true }
];

fillExampleButton.addEventListener('click', () => {
  shareInput.value = exampleText;
  shareInput.focus();
});

clearButton.addEventListener('click', () => {
  shareInput.value = '';
  resultPanel.classList.add('hidden');
  hideMessage();
  shareInput.focus();
});

parseButton.addEventListener('click', parseInput);
shareInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    parseInput();
  }
});

async function parseInput() {
  const input = shareInput.value.trim();

  if (!input) {
    showMessage('请先粘贴抖音分享文本或链接。', 'error');
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

    renderResult(payload.data);
    showMessage(payload.data.found ? '解析完成。' : '已完成跳转解析，但没有找到明确的 UID 字段。', payload.data.found ? 'success' : 'info');
  } catch (error) {
    showMessage(error.message || '解析失败，请检查链接是否有效。', 'error');
  } finally {
    setLoading(false);
  }
}

function renderResult(data) {
  resultGrid.innerHTML = '';

  for (const field of resultFields) {
    resultGrid.appendChild(createResultCard(field.label, data[field.key], field.full));
  }

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
