import fs from 'fs-extra';
import path from 'path';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class HarmonyDocsScraper {
  constructor(startUrl, outputDir = 'output', incremental = false, dryRun = false, stage = 'all') {
    this.startUrl = startUrl;
    this.outputDir = path.resolve(__dirname, '..', outputDir);
    this.incremental = incremental;
    this.dryRun = dryRun;
    this.stage = stage; // 'extract', 'scrape', 'all'
    this.linksFile = path.resolve(__dirname, '..', 'links.json');
    this.browser = null;
    this.page = null;
    this.visitedUrls = new Set();
    this.failedUrls = [];
    this.successCount = 0;
    this.skippedCount = 0;
  }

  async generateIndexHtml(links) {
    const items = links.map(({ url, title }) => {
      const rel = path
        .relative(this.outputDir, this.urlToFilePath(url))
        .split(path.sep)
        .join('/');
      const safeTitle = title || new URL(url).pathname.split('/').pop() || 'untitled';
      return `<li><a href="${rel}">${safeTitle}</a></li>`;
    });
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harmony Docs 索引</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:980px;margin:24px auto;padding:0 16px}h1{font-size:22px;margin:0 0 12px}#q{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;margin:10px 0}ul{list-style:none;margin:0;padding:0}li{padding:6px 0;border-bottom:1px solid #f0f0f0}a{text-decoration:none;color:#0366d6}a:hover{text-decoration:underline}.meta{color:#666;font-size:12px;margin-bottom:8px}</style></head><body><h1>Harmony Docs 索引</h1><div class="meta">共 ${links.length} 个页面</div><input id="q" type="search" placeholder="输入关键词过滤..."/><ul id="list">${items.join('')}</ul><script>const q=document.getElementById('q');const list=document.getElementById('list');q.addEventListener('input',()=>{const k=q.value.toLowerCase();for(const li of list.children){const a=li.querySelector('a');const t=a.textContent.toLowerCase();li.style.display=t.includes(k)?'':'none';}});</script></body></html>`;
    await fs.ensureDir(this.outputDir);
    const indexPath = path.join(this.outputDir, 'index.html');
    await fs.writeFile(indexPath, html, 'utf-8');
    console.log(`✅ 已生成索引: ${indexPath}`);
  }

  /**
   * 初始化浏览器
   */
  async init() {
    console.log('🚀 启动浏览器...');
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.page = await this.browser.newPage();

    // 设置视口和用户代理
    await this.page.setViewport({ width: 1920, height: 1080 });
    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
  }

  /**
   * 等待目录树完全加载并展开所有节点
   */
  async waitForDirectoryTree() {
    console.log('⏳ 等待目录树加载...');

    // 精确等待 Ant Design 树组件的节点元素出现
    try {
      await this.page.waitForSelector('.ant-tree-node-content-wrapper', {
        timeout: 30000,
      });
      console.log('✅ 目录树节点已加载');
    } catch (e) {
      console.log('⚠️  未找到 .ant-tree-node-content-wrapper 元素，继续尝试其他选择器...');

      // 如果找不到精确选择器，尝试备用选择器
      const fallbackSelectors = ['.ant-tree', '[class*="tree"]', 'nav', '.sidebar'];

      let found = false;
      for (const selector of fallbackSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 5000 });
          console.log(`✅ 找到备用目录容器: ${selector}`);
          found = true;
          break;
        } catch (err) {
          // 继续尝试下一个选择器
        }
      }

      if (!found) {
        console.log('⚠️  未找到目录容器，继续等待...');
      }
    }

    // 等待目录树完全渲染
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 展开所有可展开的节点
    console.log('📂 展开所有目录节点...');

    // 循环点击所有 .ant-tree-switcher_close 元素，直到没有更多
    let hasMore = true;
    let totalExpanded = 0;
    while (hasMore) {
      const expandedCount = await this.page.evaluate(() => {
        // 查找所有 .ant-tree-switcher_close 元素
        const closeSwitchers = document.querySelectorAll('.ant-tree-switcher_close');
        let count = 0;

        closeSwitchers.forEach((el) => {
          try {
            el.click();
            count++;
          } catch (e) {
            // 忽略点击错误
          }
        });

        return count;
      });

      if (expandedCount === 0) {
        hasMore = false;
      } else {
        totalExpanded += expandedCount;
        console.log(`   展开 ${expandedCount} 个节点...`);
        // 等待展开动画完成
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (totalExpanded > 0) {
      console.log(`✅ 共展开 ${totalExpanded} 个节点`);
    } else {
      console.log('✅ 所有节点已展开');
    }

    // 等待展开动画和内容加载
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  /**
   * 提取左侧目录树中的所有链接
   */
  async extractLinks() {
    console.log('📖 访问起始页面:', this.startUrl);
    await this.page.goto(this.startUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    // 等待并展开目录树
    await this.waitForDirectoryTree();

    // 在浏览器上下文中提取所有链接
    const links = await this.page.evaluate((baseUrl) => {
      const result = [];
      const base = new URL(baseUrl);

      // 查找页面中所有的 a 标签
      const linkElements = document.querySelectorAll('a[href]');

      linkElements.forEach((el) => {
        try {
          const href = el.getAttribute('href');
          if (!href) return;

          let url;
          if (href.startsWith('http://') || href.startsWith('https://')) {
            url = new URL(href);
          } else if (href.startsWith('/')) {
            url = new URL(href, base.origin);
          } else {
            url = new URL(href, baseUrl);
          }

          // 只保留同域且路径包含 /doc/ 的链接
          if (url.origin === base.origin && url.pathname.includes('/doc/')) {
            const urlString = url.toString();
            // 移除 hash
            const cleanUrl = urlString.split('#')[0];

            // 获取链接文本（去除图标和空白）
            let text = el.textContent?.trim() || '';
            // 移除可能的箭头字符
            text = text.replace(/[▶▼]/g, '').trim();

            // 去重
            if (!result.find((item) => item.url === cleanUrl)) {
              result.push({
                url: cleanUrl,
                title: text || url.pathname.split('/').pop() || 'untitled',
                pathname: url.pathname,
              });
            }
          }
        } catch (e) {
          // 忽略无效 URL
        }
      });

      return result;
    }, this.startUrl);

    console.log(`✅ 找到 ${links.length} 个文档链接`);
    return links;
  }

  /**
   * 将 URL 转换为文件路径
   */
  urlToFilePath(url) {
    try {
      const urlObj = new URL(url);
      let filePath = urlObj.pathname;

      // 移除开头的斜杠
      if (filePath.startsWith('/')) {
        filePath = filePath.substring(1);
      }

      // 清理路径中的特殊字符
      filePath = filePath.replace(/[<>:"|?*]/g, '_');

      // 如果路径为空或只是斜杠，使用默认名称
      if (!filePath || filePath === '/') {
        filePath = 'index';
      }

      // 确保以 .html 结尾
      if (!filePath.endsWith('.html')) {
        filePath = filePath + '.html';
      }

      return path.join(this.outputDir, filePath);
    } catch (e) {
      console.error('❌ URL 转换失败:', url, e.message);
      return path.join(this.outputDir, 'error.html');
    }
  }

  /**
   * 抓取单个页面
   */
  async scrapePage(url, title) {
    if (this.visitedUrls.has(url)) {
      return;
    }

    this.visitedUrls.add(url);
    const filePath = this.urlToFilePath(url);

    // 增量模式下，如果文件已存在则跳过
    if (this.incremental) {
      const exists = await fs.pathExists(filePath);
      if (exists) {
        this.skippedCount++;
        console.log(`⏭️  跳过（已存在）: ${title} (${url})`);
        return;
      }
    }

    try {
      console.log(`📄 抓取: ${title} (${url})`);

      // 创建目录
      await fs.ensureDir(path.dirname(filePath));

      // 访问页面
      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      // 等待内容加载
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 获取完整 HTML
      const html = await this.page.content();

      // 保存文件
      await fs.writeFile(filePath, html, 'utf-8');

      this.successCount++;
      console.log(`✅ 已保存: ${filePath}`);
    } catch (error) {
      console.error(`❌ 抓取失败: ${url}`, error.message);
      this.failedUrls.push({ url, title, error: error.message });
    }
  }

  /**
   * 保存链接到文件
   */
  async saveLinks(links) {
    const data = {
      extractedAt: new Date().toISOString(),
      startUrl: this.startUrl,
      total: links.length,
      links: links,
    };
    await fs.writeJson(this.linksFile, data, { spaces: 2 });
    console.log(`💾 链接已保存到: ${this.linksFile}`);
  }

  /**
   * 从文件读取链接
   */
  async loadLinks() {
    try {
      const data = await fs.readJson(this.linksFile);
      console.log(`📂 从文件加载链接: ${this.linksFile}`);
      console.log(`   提取时间: ${data.extractedAt}`);
      console.log(`   链接数量: ${data.total}`);
      return data.links || [];
    } catch (error) {
      console.error(`❌ 读取链接文件失败: ${this.linksFile}`, error.message);
      throw new Error(`链接文件不存在，请先运行提取阶段 (--stage extract)`);
    }
  }

  /**
   * 阶段1：提取链接
   */
  async extractStage() {
    try {
      console.log('📖 阶段1：提取页面链接');
      console.log('='.repeat(50));

      // 初始化浏览器
      await this.init();

      // 提取所有链接
      const links = await this.extractLinks();

      if (links.length === 0) {
        console.log('⚠️  未找到任何链接');
        return;
      }

      // 保存链接到文件
      await this.saveLinks(links);

      // Dry-run 模式：只列出链接
      if (this.dryRun) {
        console.log('\n' + '='.repeat(50));
        console.log('🔍 Dry-run 模式：仅列出链接');
        console.log('='.repeat(50));
        console.log(`\n找到 ${links.length} 个链接：\n`);

        links.forEach((link, index) => {
          console.log(`${index + 1}. ${link.title}`);
          console.log(`   ${link.url}\n`);
        });

        console.log('='.repeat(50));
        console.log(`总计: ${links.length} 个链接`);
      }

      console.log('\n✅ 阶段1完成：链接提取成功');
    } catch (error) {
      console.error('❌ 提取链接失败:', error);
      throw error;
    } finally {
      await this.close();
    }
  }

  /**
   * 阶段2：抓取页面
   */
  async scrapeStage() {
    try {
      console.log('📄 阶段2：抓取页面');
      console.log('='.repeat(50));

      // 从文件加载链接
      const links = await this.loadLinks();

      if (links.length === 0) {
        console.log('⚠️  链接列表为空');
        return;
      }

      // Dry-run 模式下不需要清空输出目录
      if (!this.dryRun) {
        // 根据增量模式决定是否清空输出目录
        if (this.incremental) {
          console.log('📦 增量抓取模式：保留已存在的文件');
        } else {
          console.log('🧹 全量抓取模式：清空输出目录...');
          await fs.emptyDir(this.outputDir);
        }
      }

      // 初始化浏览器
      await this.init();

      // Dry-run 模式：只列出链接，不进行抓取
      if (this.dryRun) {
        console.log('\n' + '='.repeat(50));
        console.log('🔍 Dry-run 模式：仅列出链接，不进行抓取');
        console.log('='.repeat(50));
        console.log(`\n找到 ${links.length} 个链接：\n`);

        links.forEach((link, index) => {
          console.log(`${index + 1}. ${link.title}`);
          console.log(`   ${link.url}\n`);
        });

        console.log('='.repeat(50));
        console.log(`总计: ${links.length} 个链接`);
        return;
      }

      // 抓取所有页面
      console.log(`\n开始抓取 ${links.length} 个页面...\n`);

      for (let i = 0; i < links.length; i++) {
        const { url, title } = links[i];
        console.log(`[${i + 1}/${links.length}]`);
        await this.scrapePage(url, title);

        // 添加延迟，避免请求过快
        if (i < links.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      // 输出统计信息
      console.log('\n' + '='.repeat(50));
      console.log('📊 阶段2完成：抓取完成！');
      console.log(`✅ 成功: ${this.successCount} 个页面`);
      if (this.incremental && this.skippedCount > 0) {
        console.log(`⏭️  跳过: ${this.skippedCount} 个页面（已存在）`);
      }
      console.log(`❌ 失败: ${this.failedUrls.length} 个页面`);

      if (this.failedUrls.length > 0) {
        console.log('\n失败的页面:');
        this.failedUrls.forEach(({ url, title, error }) => {
          console.log(`  - ${title}: ${url} (${error})`);
        });
      }
      console.log('='.repeat(50));

      if (!this.dryRun) {
        await this.generateIndexHtml(links);
      }
    } catch (error) {
      console.error('❌ 抓取过程出错:', error);
      throw error;
    } finally {
      await this.close();
    }
  }

  /**
   * 抓取所有页面（完整流程）
   */
  async scrapeAll() {
    try {
      // 根据阶段参数决定执行哪个阶段
      if (this.stage === 'extract') {
        await this.extractStage();
        return;
      } else if (this.stage === 'scrape') {
        await this.scrapeStage();
        return;
      } else if (this.stage === 'index') {
        const links = await this.loadLinks();
        if (!this.dryRun) {
          await fs.ensureDir(this.outputDir);
          await this.generateIndexHtml(links);
        } else {
          console.log('🔍 Dry-run 模式：仅预览索引生成，不写入文件');
          console.log(`索引将包含 ${links.length} 个页面`);
        }
        return;
      }

      // stage === 'all' 时执行完整流程
      // Dry-run 模式下不需要清空输出目录
      if (!this.dryRun) {
        // 根据增量模式决定是否清空输出目录
        if (this.incremental) {
          console.log('📦 增量抓取模式：保留已存在的文件');
        } else {
          console.log('🧹 全量抓取模式：清空输出目录...');
          await fs.emptyDir(this.outputDir);
        }
      }

      // 初始化浏览器
      await this.init();

      // 提取所有链接
      const links = await this.extractLinks();

      // 保存链接到文件
      await this.saveLinks(links);

      // Dry-run 模式：只列出链接，不进行抓取
      if (this.dryRun) {
        console.log('\n' + '='.repeat(50));
        console.log('🔍 Dry-run 模式：仅列出链接，不进行抓取');
        console.log('='.repeat(50));
        console.log(`\n找到 ${links.length} 个链接：\n`);

        links.forEach((link, index) => {
          console.log(`${index + 1}. ${link.title}`);
          console.log(`   ${link.url}\n`);
        });

        console.log('='.repeat(50));
        console.log(`总计: ${links.length} 个链接`);
        return;
      }

      if (links.length === 0) {
        console.log('⚠️  未找到任何链接，尝试抓取起始页面...');
        // 至少抓取起始页面
        await this.scrapePage(this.startUrl, '起始页面');
      } else {
        // 抓取所有页面
        console.log(`\n开始抓取 ${links.length} 个页面...\n`);

        for (let i = 0; i < links.length; i++) {
          const { url, title } = links[i];
          console.log(`[${i + 1}/${links.length}]`);
          await this.scrapePage(url, title);

          // 添加延迟，避免请求过快
          if (i < links.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      }

      // 输出统计信息
      console.log('\n' + '='.repeat(50));
      console.log('📊 抓取完成！');
      console.log(`✅ 成功: ${this.successCount} 个页面`);
      if (this.incremental && this.skippedCount > 0) {
        console.log(`⏭️  跳过: ${this.skippedCount} 个页面（已存在）`);
      }
      console.log(`❌ 失败: ${this.failedUrls.length} 个页面`);

      if (this.failedUrls.length > 0) {
        console.log('\n失败的页面:');
        this.failedUrls.forEach(({ url, title, error }) => {
          console.log(`  - ${title}: ${url} (${error})`);
        });
      }
      console.log('='.repeat(50));

      if (!this.dryRun) {
        await this.generateIndexHtml(links || []);
      }
    } catch (error) {
      console.error('❌ 抓取过程出错:', error);
      throw error;
    } finally {
      await this.close();
    }
  }

  /**
   * 关闭浏览器
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('🔒 浏览器已关闭');
    }
  }
}

export default HarmonyDocsScraper;
