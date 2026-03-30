const noticeList = document.querySelector('#noticeList');
const statusText = document.querySelector('#statusText');
const sourceBadge = document.querySelector('#sourceBadge');
const refreshButton = document.querySelector('#refreshButton');
const prevPageButton = document.querySelector('#prevPageButton');
const nextPageButton = document.querySelector('#nextPageButton');
const pageInfo = document.querySelector('#pageInfo');
const detailTitle = document.querySelector('#detailTitle');
const detailMeta = document.querySelector('#detailMeta');
const detailBody = document.querySelector('#detailBody');
const detailOriginLink = document.querySelector('#detailOriginLink');
const syncTimeText = document.querySelector('#syncTimeText');
const totalItemsText = document.querySelector('#totalItemsText');
const totalPagesText = document.querySelector('#totalPagesText');
const template = document.querySelector('#noticeCardTemplate');
const detailPanel = document.querySelector('.panel-detail');
const body = document.body;

const DATA_ROOT = new URL('./data/notices/', window.location.href);
const mobileQuery = window.matchMedia('(max-width: 720px)');

const state = {
  page: 1,
  totalPages: 1,
  totalItems: 0,
  items: [],
  selectedUrl: '',
  generatedAt: ''
};

function setListLoading(text = '正在加载数据...') {
  statusText.textContent = text;
}

function renderEmpty(message) {
  noticeList.innerHTML = `<div class="empty-state">${message}</div>`;
}

function renderPagination() {
  pageInfo.textContent = `第 ${state.page} / ${state.totalPages} 页`;
  prevPageButton.disabled = state.page <= 1;
  nextPageButton.disabled = state.page >= state.totalPages;
}

function formatDateTime(value) {
  if (!value) {
    return '--';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function updateHeroStats() {
  syncTimeText.textContent = formatDateTime(state.generatedAt);
  totalItemsText.textContent = state.totalItems ? `${state.totalItems} 条` : '--';
  totalPagesText.textContent = state.totalPages ? `${state.totalPages} 页` : '--';
}

function applyLayoutMode() {
  const isMobile = mobileQuery.matches;
  body.classList.toggle('is-mobile-layout', isMobile);
  body.classList.toggle('is-desktop-layout', !isMobile);
}

function renderNotices(items) {
  noticeList.innerHTML = '';

  if (!items.length) {
    renderEmpty('当前页暂无数据。');
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.notice-card');
    const date = node.querySelector('.notice-date');
    const title = node.querySelector('.notice-title');
    const summary = node.querySelector('.notice-summary');
    const viewButton = node.querySelector('.notice-view-button');
    const originLink = node.querySelector('.notice-origin-link');

    if (item.link === state.selectedUrl) {
      card.classList.add('is-active');
    }

    date.textContent = item.date || '--';
    title.textContent = item.title || '未命名公示';
    summary.textContent = item.summary || '点击查看正文。';

    viewButton.addEventListener('click', () => loadDetail(item.link));
    originLink.href = item.link || '#';
    originLink.textContent = '原站详情';

    fragment.appendChild(node);
  });

  noticeList.appendChild(fragment);
}

function renderDetailLoading() {
  detailTitle.textContent = '正在加载正文...';
  detailMeta.innerHTML = '';
  detailBody.className = 'detail-body detail-empty';
  detailBody.textContent = '请稍候，正在读取公示正文。';
}

function renderDetailError(message) {
  detailTitle.textContent = '正文加载失败';
  detailMeta.innerHTML = '';
  detailBody.className = 'detail-body detail-empty';
  detailBody.textContent = message;
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

  detailTitle.textContent = data.title || '未命名公示';
  detailMeta.innerHTML = metaParts.join('');
  detailOriginLink.href = data.link || 'https://jwc.fjtcm.edu.cn/955/list.htm';
  detailBody.className = 'detail-body';
  detailBody.innerHTML = `${renderAttachments(data.attachments)}${wrapTables(data.contentHtml || '<p>该公示暂无正文。</p>')}`;

  if (mobileQuery.matches) {
    detailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function fetchJson(relativePath) {
  const response = await fetch(new URL(relativePath, DATA_ROOT));

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function loadNotices(page = 1, options = {}) {
  const shouldSelectFirst = options.selectFirst !== false;
  setListLoading('正在加载数据...');

  try {
    const data = await fetchJson(`page-${page}.json`);
    state.page = data.page || page;
    state.totalPages = data.totalPages || 1;
    state.totalItems = data.totalItems || 0;
    state.items = data.items || [];
    state.generatedAt = data.generatedAt || data.fetchedAt || '';

    if (!state.items.some((item) => item.link === state.selectedUrl)) {
      state.selectedUrl = '';
    }

    renderNotices(state.items);
    renderPagination();
    updateHeroStats();

    sourceBadge.textContent = mobileQuery.matches ? 'mobile' : data.source || 'static';
    statusText.textContent = `共 ${state.totalItems} 条，当前第 ${state.page} 页，本页展示 ${data.itemCountOnPage || state.items.length} 条。`;

    if (shouldSelectFirst && state.items.length && !state.selectedUrl) {
      await loadDetail(state.items[0].link, { rerenderList: true });
      return;
    }

    if (state.selectedUrl) {
      renderNotices(state.items);
    }
  } catch (error) {
    renderEmpty('列表加载失败，请稍后重试。');
    sourceBadge.textContent = 'error';
    statusText.textContent = `请求失败：${error.message}`;
    renderPagination();
  }
}

async function loadDetail(url, options = {}) {
  const rerenderList = options.rerenderList !== false;
  state.selectedUrl = url;

  if (rerenderList) {
    renderNotices(state.items);
  }

  renderDetailLoading();
  detailOriginLink.href = url;

  try {
    const item = state.items.find((entry) => entry.link === url);

    if (!item?.detailId) {
      throw new Error('缺少详情索引');
    }

    const data = await fetchJson(`details/${item.detailId}.json`);
    renderDetail(data);

    if (rerenderList) {
      renderNotices(state.items);
    }
  } catch (error) {
    renderDetailError(`请求失败：${error.message}`);
  }
}

refreshButton.addEventListener('click', () => {
  state.selectedUrl = '';
  loadNotices(state.page);
});

prevPageButton.addEventListener('click', () => {
  if (state.page > 1) {
    state.selectedUrl = '';
    loadNotices(state.page - 1);
  }
});

nextPageButton.addEventListener('click', () => {
  if (state.page < state.totalPages) {
    state.selectedUrl = '';
    loadNotices(state.page + 1);
  }
});

mobileQuery.addEventListener('change', () => {
  applyLayoutMode();
  sourceBadge.textContent = mobileQuery.matches ? 'mobile' : 'static';
});

applyLayoutMode();
renderPagination();
updateHeroStats();
loadNotices(1);
