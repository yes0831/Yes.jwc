# Yes.jwc

福建中医药大学教务处“学校公示”静态展示页。

## 功能

- 自动抓取公告列表和详情
- 展示正文、附件、表格数据
- 适配手机屏幕
- 支持 GitHub Pages 静态发布
- 支持 GitHub Actions 定时同步

## 本地运行

```bash
node scripts/sync-data.js
node server.js
```

然后打开 `http://127.0.0.1:3000`

## 自动部署

仓库包含 `.github/workflows/pages.yml`。

推送到 `main` 后会自动：

1. 运行 `node scripts/sync-data.js`
2. 生成 `public/data/notices/*.json`
3. 将 `public/` 部署到 GitHub Pages
