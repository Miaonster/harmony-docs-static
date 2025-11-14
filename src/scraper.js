import puppeteer from 'puppeteer';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class HarmonyDocsScraper {
  constructor(startUrl, outputDir = 'output') {
    this.startUrl = startUrl;
    this.outputDir = path.resolve(__dirname, '..', outputDir);
    this.browser = null;
    this.page = null;
    this.visitedUrls = new Set();
    this.failedUrls = [];
    this.successCount = 0;
  }

  /**
   * 初始化浏览器
   */
  async init() {
    console.log('🚀 启动浏览器...');
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.page = await this.browser.newPage();
    
    // 设置视口和用户代理
    await this.page.setViewport({ width: 1920, height: 1080 });
    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
  }

  /**
   * 提取左侧目录树中的所有链接
   */
  async extractLinks() {
    console.log('📖 访问起始页面:', this.startUrl);
    await this.page.goto(this.startUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // 等待目录树加载（可能需要等待特定的选择器）
    console.log('⏳ 等待目录树加载...');
    try {
      // 尝试等待常见的目录树选择器
      await this.page.waitForSelector('nav, .sidebar, .menu, .tree, [class*="nav"], [class*="menu"], [class*="sidebar"]', {
        timeout: 10000
      });
    } catch (e) {
      console.log('⚠️  未找到明确的目录树选择器，继续尝试提取链接...');
    }

    // 额外等待一下，确保 JS 完全渲染
    await this.page.waitForTimeout(2000);

    // 在浏览器上下文中提取所有链接
    const links = await this.page.evaluate((baseUrl) => {
      const result = [];
      const base = new URL(baseUrl);
      
      // 查找所有可能的链接元素
      const selectors = [
        'a[href]',
        'nav a[href]',
        '.sidebar a[href]',
        '.menu a[href]',
        '[class*="nav"] a[href]',
        '[class*="menu"] a[href]',
        '[class*="sidebar"] a[href]'
      ];

      const linkElements = new Set();
      
      selectors.forEach(selector => {
        try {
          document.querySelectorAll(selector).forEach(el => {
            const href = el.getAttribute('href');
            if (href) {
              linkElements.add({ href, text: el.textContent?.trim() || '' });
            }
          });
        } catch (e) {
          // 忽略选择器错误
        }
      });

      // 处理所有找到的链接
      linkElements.forEach(({ href, text }) => {
        try {
          let url;
          if (href.startsWith('http://') || href.startsWith('https://')) {
            url = new URL(href);
          } else if (href.startsWith('/')) {
            url = new URL(href, base.origin);
          } else {
            url = new URL(href, baseUrl);
          }

          // 只保留同域的文档链接
          if (url.origin === base.origin && url.pathname.includes('/doc/')) {
            const urlString = url.toString();
            // 移除 hash
            const cleanUrl = urlString.split('#')[0];
            
            if (!result.find(item => item.url === cleanUrl)) {
              result.push({
                url: cleanUrl,
                title: text || url.pathname.split('/').pop() || 'untitled',
                pathname: url.pathname
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

    try {
      console.log(`📄 抓取: ${title} (${url})`);
      
      // 创建目录
      await fs.ensureDir(path.dirname(filePath));

      // 访问页面
      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      // 等待内容加载
      await this.page.waitForTimeout(1000);

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
   * 抓取所有页面
   */
  async scrapeAll() {
    try {
      // 清空输出目录
      console.log('🧹 清空输出目录...');
      await fs.emptyDir(this.outputDir);

      // 初始化浏览器
      await this.init();

      // 提取所有链接
      const links = await this.extractLinks();

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
            await this.page.waitForTimeout(500);
          }
        }
      }

      // 输出统计信息
      console.log('\n' + '='.repeat(50));
      console.log('📊 抓取完成！');
      console.log(`✅ 成功: ${this.successCount} 个页面`);
      console.log(`❌ 失败: ${this.failedUrls.length} 个页面`);
      
      if (this.failedUrls.length > 0) {
        console.log('\n失败的页面:');
        this.failedUrls.forEach(({ url, title, error }) => {
          console.log(`  - ${title}: ${url} (${error})`);
        });
      }
      console.log('='.repeat(50));

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

