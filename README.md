# Harmony Docs Scraper

抓取华为 HarmonyOS 开发者文档，生成本地静态页面，并通过 GitHub Pages 发布。内置索引页（`docs/index.html`）支持关键字过滤与快速跳转。

## 功能

- 提取起始页面的所有文档链接到 `links.json`
- 抓取链接对应页面并保存到 `docs/`（HTML 原样保存）
- 生成站点首页索引 `docs/index.html`
- 一键 GitHub Actions 发布为 GitHub Pages

## 快速开始

1. 安装依赖

```bash
pnpm install
```

2. 运行完整流程（提取 → 抓取 → 生成索引）

```bash
pnpm start
```

3. 打开本地输出

```text
docs/index.html
```

## 命令行用法

入口：`src/index.js`

支持参数：

- `--incremental, -i` 增量抓取（保留已存在文件）
- `--dry-run, -d` 仅列出链接，不抓取
- `--stage, -s <stage>` 执行阶段：`extract`、`scrape`、`index`、`all`
- `--output, -o <dir>` 指定输出目录（默认 `docs`）
- `--url, -u <url>` 指定起始 URL（默认内置）

示例：

```bash
# 仅提取链接
pnpm start --stage extract

# 仅抓取页面（依赖已存在的 links.json）
pnpm start --stage scrape

# 增量抓取（跳过已存在文件）
pnpm start --stage scrape --incremental

# 仅生成索引页（基于 links.json）
pnpm start --stage index
```

## 阶段说明

- `extract`：访问起始页面，提取所有符合条件链接到 `links.json`
- `scrape`：读取 `links.json` 抓取页面到 `docs/`
- `index`：基于 `links.json` 生成 `docs/index.html`
- `all`：完整流程（默认）

## GitHub Pages 部署

仓库已包含工作流：`.github/workflows/deploy.yml`

- 触发：推送到 `main` 或手动触发
- 步骤：`pnpm install` → `pnpm start` → 上传 `docs/` 为 Pages 产物
- 配置：Settings → Pages → Source 选择 `GitHub Actions`

推送后访问：

```text
https://<用户名>.github.io/<仓库名>/
```

实际部署地址：

```text
https://miaonster.github.io/harmony-docs-static/
```

## 静态文档与索引

原始 HarmonyOS 开发者文档为动态站点（部分内容依赖运行时脚本渲染）。本项目抓取并生成了静态镜像，已发布到 GitHub Pages：

```text
https://miaonster.github.io/harmony-docs-static/
```

该静态站点可与 Cursor Docs 等文档索引工具配合使用，对页面进行离线索引与检索，便于在本地或编辑器内快速查询。

## CI

通用 CI 工作流：`.github/workflows/ci.yml`

- 触发：`push`、`pull_request`
- 步骤：Checkout → Setup Node（缓存 pnpm）→ Setup pnpm → 安装 → `pnpm build` → `pnpm test`

项目暂未提供真实构建/测试逻辑，示例脚本为占位，可按需替换。

## 依赖与环境

- Node.js 20+
- 包管理器：pnpm（Actions 通过 Corepack 激活）
- 运行时依赖：`puppeteer`（headless Chrome）与 `fs-extra`

## 代码位置参考

- 参数解析：`src/index.js:9-71`
- 阶段调度：`src/scraper.js:440-451` 与 `src/scraper.js:469`
- 链接保存/读取：`src/scraper.js:278-287`、`src/scraper.js:292-302`
- URL→文件映射：`src/scraper.js:195-223`
- 抓取单页：`src/scraper.js:228-273`
- 索引生成：`src/scraper.js:25-43`

## 常见问题

- Actions 无法找到 pnpm：工作流已通过 Corepack 激活 `pnpm@9`
- 锁文件未找到：使用 `pnpm-lock.yaml`，并在 `setup-node` 使用 `cache: pnpm`
- 索引覆盖主页：若同时抓取了根路径，生成索引会覆盖 `docs/index.html`。如需保留原始首页，可调整生成策略。

## 许可

MIT