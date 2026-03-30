const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const BASE_URL = new URL('https://jwc.fjtcm.edu.cn');
const NOTICE_SECTION = '学校公示';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data', 'notices');
const DETAIL_DIR = path.join(OUTPUT_DIR, 'details');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(DETAIL_DIR, { recursive: true });

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanText(value) {
  return normalizeWhitespace(decodeHtmlEntities(stripTags(value)));
}

function summarizeTitle(title) {
  const compact = normalizeWhitespace(title || '');

  if (!compact) {
    return '点击查看学校公示正文。';
  }

  if (compact.length <= 36) {
    return `${compact}。`;
  }

  return `${compact.slice(0, 36)}...`;
}

function normalizeEncoding(label) {
  const encoding = String(label || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();

  if (!encoding) {
    return 'utf-8';
  }

  if (['gbk', 'gb2312', 'gb-2312', 'gb_2312', 'x-gbk'].includes(encoding)) {
    return 'gb18030';
  }

  if (encoding === 'utf8') {
    return 'utf-8';
  }

  return encoding;
}

function detectEncoding(buffer, headers = {}) {
  const contentType = headers['content-type'] || '';
  let match = contentType.match(/charset=([^;]+)/i);

  if (match) {
    return normalizeEncoding(match[1]);
  }

  const head = buffer.slice(0, 8192).toString('ascii');
  match =
    head.match(/<meta[^>]+charset=['"]?([a-zA-Z0-9._-]+)/i) ||
    head.match(/<meta[^>]+content=['"][^'"]*charset=([a-zA-Z0-9._-]+)/i);

  return normalizeEncoding(match ? match[1] : '');
}

function decodeRemoteBuffer(buffer, headers) {
  const encoding = detectEncoding(buffer, headers);

  try {
    return new TextDecoder(encoding).decode(buffer).replace(/^\uFEFF/, '');
  } catch (error) {
    return new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
  }
}

function buildListPath(page) {
  return page <= 1 ? '/955/list.htm' : `/955/list${page}.htm`;
}

function makeAbsoluteUrl(urlValue) {
  return new URL(urlValue, BASE_URL).toString();
}

function assertAllowedUrl(urlValue) {
  const url = new URL(urlValue, BASE_URL);

  if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== BASE_URL.hostname) {
    throw new Error('仅支持福建中医药大学教务处站点链接。');
  }

  return url;
}

function fetchRemoteText(urlValue, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error('远程重定向次数过多。'));
  }

  const targetUrl = new URL(urlValue);
  const client = targetUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(
      targetUrl,
      {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'identity'
        },
        ciphers: 'DEFAULT@SECLEVEL=0',
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
      },
      (response) => {
        const statusCode = response.statusCode || 0;

        if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
          const nextUrl = new URL(response.headers.location, targetUrl).toString();
          response.resume();
          fetchRemoteText(nextUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`远程请求失败: HTTP ${statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve(decodeRemoteBuffer(buffer, response.headers));
        });
      }
    );

    request.on('error', reject);
    request.end();
  });
}

function detailIdForUrl(urlValue) {
  return crypto.createHash('sha1').update(urlValue).digest('hex');
}

function extractBalancedElementInnerHtml(html, startIndex, tagName) {
  const tagRegex = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  tagRegex.lastIndex = startIndex;

  let depth = 0;
  let contentStart = -1;
  let match;

  while ((match = tagRegex.exec(html))) {
    const token = match[0];
    const isClosing = token.startsWith('</');
    const isSelfClosing = token.endsWith('/>');

    if (contentStart === -1) {
      depth = 1;
      contentStart = match.index + token.length;
      continue;
    }

    if (isClosing) {
      depth -= 1;
    } else if (!isSelfClosing) {
      depth += 1;
    }

    if (depth === 0) {
      return html.slice(contentStart, match.index);
    }
  }

  return '';
}

function extractElementInnerHtmlByClass(html, className) {
  const pattern = new RegExp(
    `<([a-z0-9]+)[^>]*class=(['"])[^'"]*\\b${escapeRegExp(className)}\\b[^'"]*\\2[^>]*>`,
    'i'
  );
  const match = pattern.exec(html);

  if (!match) {
    return '';
  }

  return extractBalancedElementInnerHtml(html, match.index, match[1]);
}

function extractTextByClass(html, className) {
  const pattern = new RegExp(
    `<[^>]*class=(['"])[^'"]*\\b${escapeRegExp(className)}\\b[^'"]*\\1[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    'i'
  );
  const match = pattern.exec(html);
  return match ? cleanText(match[2]) : '';
}

function extractTextsByClass(html, className) {
  const pattern = new RegExp(
    `<[^>]*class=(['"])[^'"]*\\b${escapeRegExp(className)}\\b[^'"]*\\1[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    'gi'
  );

  return Array.from(html.matchAll(pattern), (match) => cleanText(match[2])).filter(Boolean);
}

function extractAttribute(tagHtml, attributeName) {
  const pattern = new RegExp(`${attributeName}=(['"])(.*?)\\1`, 'i');
  const match = pattern.exec(tagHtml);
  return match ? decodeHtmlEntities(match[2]).trim() : '';
}

function absolutizeEmbeddedUrls(html) {
  return String(html || '').replace(
    /\b(href|src)=(['"])(?!https?:|mailto:|tel:|#|data:)(.*?)\2/gi,
    (_, attr, quote, rawUrl) => `${attr}=${quote}${makeAbsoluteUrl(rawUrl)}${quote}`
  );
}

function sanitizeArticleHtml(html) {
  return absolutizeEmbeddedUrls(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z]+=(['"]).*?\1/gi, '')
  ).trim();
}

function cleanMetaValue(value, prefixes) {
  let result = normalizeWhitespace(value || '');

  for (const prefix of prefixes) {
    result = result.replace(prefix, '');
  }

  return normalizeWhitespace(result);
}

function extractAttachments(contentHtml) {
  const anchors = contentHtml.matchAll(/<a\b[^>]*href=(['"])([^'"]+)\1[^>]*>([\s\S]*?)<\/a>/gi);
  const seen = new Set();
  const attachments = [];

  for (const match of anchors) {
    const rawLink = match[2];
    const linkText = cleanText(match[3]);

    if (!rawLink || /^javascript:/i.test(rawLink)) {
      continue;
    }

    const link = makeAbsoluteUrl(rawLink);

    if (seen.has(link)) {
      continue;
    }

    seen.add(link);

    let fileName = linkText;

    if (!fileName) {
      const pathname = new URL(link).pathname;
      fileName = decodeURIComponent(path.posix.basename(pathname) || '附件');
    }

    attachments.push({
      name: fileName,
      link,
      extension: path.posix.extname(new URL(link).pathname).toLowerCase()
    });
  }

  return attachments;
}

function extractImages(contentHtml) {
  const images = [];
  const seen = new Set();
  const pattern = /<img\b[^>]*src=(['"])([^'"]+)\1[^>]*>/gi;
  let match;

  while ((match = pattern.exec(contentHtml))) {
    const link = makeAbsoluteUrl(match[2]);

    if (seen.has(link)) {
      continue;
    }

    seen.add(link);
    images.push({
      src: link,
      alt: extractAttribute(match[0], 'alt')
    });
  }

  return images;
}

function extractTables(contentHtml) {
  const tables = [];
  const tablePattern = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tablePattern.exec(contentHtml))) {
    const rows = [];
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowPattern.exec(tableMatch[1]))) {
      const cells = [];
      const cellPattern = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let cellMatch;

      while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
        cells.push(cleanText(cellMatch[1]));
      }

      if (cells.some(Boolean)) {
        rows.push(cells);
      }
    }

    if (rows.length) {
      tables.push(rows);
    }
  }

  return tables;
}

function extractNoticeItems(html, page) {
  const itemPattern = /<li\b[^>]*class=(['"])[^'"]*\bnews\b[^'"]*\1[^>]*>([\s\S]*?)<\/li>/gi;
  const items = [];
  const seenLinks = new Set();
  let match;
  let index = 0;

  while ((match = itemPattern.exec(html))) {
    const block = match[2];
    const anchorMatch = block.match(/<a\b([^>]*)href=(['"])([^'"]+)\2([^>]*)>([\s\S]*?)<\/a>/i);

    if (!anchorMatch) {
      continue;
    }

    const href = anchorMatch[3];
    const titleAttr = extractAttribute(anchorMatch[0], 'title');
    const title = cleanText(titleAttr || anchorMatch[5]);
    const link = makeAbsoluteUrl(href);
    const dateMatch =
      block.match(
        /<span\b[^>]*class=(['"])[^'"]*\bnews_meta\b[^'"]*\1[^>]*>\[?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*\]?<\/span>/i
      ) || block.match(/\b([0-9]{4}-[0-9]{2}-[0-9]{2})\b/);

    if (!title || seenLinks.has(link)) {
      continue;
    }

    seenLinks.add(link);
    index += 1;
    items.push({
      id: `${page}-${index}-${Buffer.from(link).toString('base64url')}`,
      title,
      date: dateMatch ? dateMatch[2] || dateMatch[1] : '',
      link,
      detailId: detailIdForUrl(link),
      summary: summarizeTitle(title)
    });
  }

  return items;
}

async function fetchNoticeList(page) {
  const html = await fetchRemoteText(makeAbsoluteUrl(buildListPath(page)));
  const items = extractNoticeItems(html, page);
  const totalItemsMatch = html.match(/<em class="all_count">(\d+)<\/em>/i);
  const pageInfoMatch = html.match(
    /<em class="curr_page">(\d+)<\/em>\s*\/\s*<em class="all_pages">(\d+)<\/em>/i
  );

  return {
    ok: true,
    source: 'generated',
    section: NOTICE_SECTION,
    page: pageInfoMatch ? Number(pageInfoMatch[1]) : page,
    totalPages: pageInfoMatch ? Number(pageInfoMatch[2]) : 1,
    totalItems: totalItemsMatch ? Number(totalItemsMatch[1]) : items.length,
    itemCountOnPage: items.length,
    items,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchNoticeDetail(urlValue) {
  const targetUrl = assertAllowedUrl(urlValue).toString();
  const html = await fetchRemoteText(targetUrl);
  const title = extractTextByClass(html, 'arti_title');
  const updateText = extractTextByClass(html, 'arti_update');
  const publisherFields = extractTextsByClass(html, 'arti_publisher');
  const viewsText = extractTextByClass(html, 'arti_views');
  const contentHtml = sanitizeArticleHtml(extractElementInnerHtmlByClass(html, 'wp_articlecontent'));
  const contentText = cleanText(contentHtml);
  const attachments = extractAttachments(contentHtml);
  const images = extractImages(contentHtml);
  const tables = extractTables(contentHtml);

  let publisher = '';
  let author = '';

  for (const field of publisherFields) {
    if (!publisher && /^来源[:：]/.test(field)) {
      publisher = cleanMetaValue(field, [/^来源[:：]\s*/]);
      continue;
    }

    if (!author && /^作者[:：]/.test(field)) {
      author = cleanMetaValue(field, [/^作者[:：]\s*/]);
    }
  }

  return {
    ok: true,
    source: 'generated',
    detailId: detailIdForUrl(targetUrl),
    link: targetUrl,
    title,
    date: cleanMetaValue(updateText, [/^发布时间[:：]\s*/]),
    publisher,
    author,
    views: cleanMetaValue(viewsText, [/^动态浏览次数[:：]?\s*/]),
    contentHtml,
    contentText,
    attachments,
    images,
    tables,
    fetchedAt: new Date().toISOString()
  };
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function main() {
  const generatedAt = new Date().toISOString();
  const firstPage = await fetchNoticeList(1);
  const pages = [firstPage];

  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    pages.push(await fetchNoticeList(page));
  }

  const allItems = pages.flatMap((page) => page.items);
  console.log(`Fetched ${pages.length} pages and ${allItems.length} notice entries.`);

  for (const item of allItems) {
    const detail = await fetchNoticeDetail(item.link);
    detail.generatedAt = generatedAt;
    writeJson(path.join(DETAIL_DIR, `${detail.detailId}.json`), detail);
  }

  for (const page of pages) {
    writeJson(path.join(OUTPUT_DIR, `page-${page.page}.json`), {
      ...page,
      generatedAt
    });
  }

  writeJson(path.join(OUTPUT_DIR, 'index.json'), {
    ok: true,
    source: 'generated',
    section: NOTICE_SECTION,
    totalPages: firstPage.totalPages,
    totalItems: firstPage.totalItems,
    latest: firstPage.items.slice(0, 6),
    pages: pages.map((page) => ({
      page: page.page,
      itemCountOnPage: page.itemCountOnPage,
      totalItems: page.totalItems
    })),
    generatedAt
  });

  fs.writeFileSync(path.join(__dirname, '..', 'public', '.nojekyll'), '', 'utf8');
  console.log(`Static data written to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
