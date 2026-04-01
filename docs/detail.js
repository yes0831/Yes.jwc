const DATA_ROOT = new URL('./data/notices/', window.location.href);
const params = new URLSearchParams(window.location.search);

const detailBackLink = document.querySelector('#detailBackLink');
const detailPageOriginLink = document.querySelector('#detailPageOriginLink');
const detailPageTitle = document.querySelector('#detailPageTitle');
const detailPageMeta = document.querySelector('#detailPageMeta');
const detailPageBody = document.querySelector('#detailPageBody');

const detailId = params.get('id') || '';
const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
let currentGeneratedAt = '';

detailBackLink.href = `./index.html?page=${page}`;

function renderError(message) {
  detailPageTitle.textContent = '正文加载失败';
  detailPageMeta.innerHTML = '';
  detailPageBody.className = 'detail-body detail-empty';
  detailPageBody.textContent = message;
}

function renderAttachments(attachments) {
  if (!attachments?.length) {
    return '';
  }

  const links = attachments
    .map(
      (attachment) =>
        `<li class="attachment-item"><a href="${attachment.link}" target="_blank" rel="noreferrer">${
          attachment.name || attachment.link
        }</a></li>`
    )
    .join('');

  return `
    <section class="detail-section">
      <h3>附件</h3>
      <ul class="attachment-list">${links}</ul>
    </section>
  `;
}

function wrapTables(html) {
  return String(html || '').replace(
    /<table\b[\s\S]*?<\/table>/gi,
    (tableHtml) => `<div class="table-scroll">${tableHtml}</div>`
  );
}

function renderDetail(data) {
  const metaParts = [];

  if (data.date) {
    metaParts.push(`<span>发布时间：${data.date}</span>`);
  }

  if (data.publisher) {
    metaParts.push(`<span>来源：${data.publisher}</span>`);
  }

  if (data.author) {
    metaParts.push(`<span>作者：${data.author}</span>`);
  }

  if (data.views) {
    metaParts.push(`<span>浏览：${data.views}</span>`);
  }

  if (Array.isArray(data.attachments) && data.attachments.length) {
    metaParts.push(`<span>附件：${data.attachments.length}</span>`);
  }

  if (Array.isArray(data.tables) && data.tables.length) {
    metaParts.push(`<span>表格：${data.tables.length}</span>`);
  }

  document.title = `${data.title || '公告详情'} - 学校公示`;
  detailPageTitle.textContent = data.title || '未命名公示';
  detailPageMeta.innerHTML = metaParts.join('');
  detailPageOriginLink.href = data.link || 'https://jwc.fjtcm.edu.cn/955/list.htm';
  detailPageBody.className = 'detail-body';
  detailPageBody.innerHTML = `${renderAttachments(data.attachments)}${wrapTables(data.contentHtml || '<p>该公示暂无正文。</p>')}`;
}

async function loadDetail() {
  if (!detailId) {
    renderError('缺少详情参数。');
    return;
  }

  try {
    const detailUrl = new URL(`details/${detailId}.json`, DATA_ROOT);
    detailUrl.searchParams.set('_ts', String(Date.now()));
    const response = await fetch(detailUrl, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    currentGeneratedAt = data.generatedAt || data.fetchedAt || currentGeneratedAt;
    renderDetail(data);
  } catch (error) {
    renderError(`请求失败：${error.message}`);
  }
}

loadDetail();

setInterval(async () => {
  try {
    const indexUrl = new URL('index.json', DATA_ROOT);
    indexUrl.searchParams.set('_ts', String(Date.now()));
    const response = await fetch(indexUrl, { cache: 'no-store' });

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const latestGeneratedAt = data.generatedAt || data.fetchedAt || '';

    if (currentGeneratedAt && latestGeneratedAt && latestGeneratedAt !== currentGeneratedAt) {
      loadDetail();
    }
  } catch (error) {
    // Ignore polling failure and keep current detail visible.
  }
}, 60000);
