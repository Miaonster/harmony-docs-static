import HarmonyDocsScraper from './scraper.js';

const START_URL = [
  'https://developer.huawei.com/consumer/cn/doc/harmonyos-references/development-intro-api',
  'https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/application-dev-guide',
];
const OUTPUT_DIR = 'docs';

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    incremental: false,
    dryRun: false,
    stage: 'all',
    outputDir: OUTPUT_DIR,
    startUrl: START_URL,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--incremental' || arg === '-i') {
      config.incremental = true;
    } else if (arg === '--dry-run' || arg === '-d') {
      config.dryRun = true;
    } else if (arg === '--stage' || arg === '-s') {
      const stageValue = args[++i];
      if (['extract', 'scrape', 'all', 'index'].includes(stageValue)) {
        config.stage = stageValue;
      } else {
        console.error(`❌ 无效的阶段值: ${stageValue}，必须是 extract、scrape、index 或 all`);
        process.exit(1);
      }
    } else if (arg === '--output' || arg === '-o') {
      config.outputDir = args[++i] || OUTPUT_DIR;
    } else if (arg === '--url' || arg === '-u') {
      const urlArg = args[++i];
      if (urlArg) {
        // 支持逗号分隔的多个 URL
        config.startUrl = urlArg.includes(',') ? urlArg.split(',').map((u) => u.trim()) : [urlArg];
      } else {
        config.startUrl = START_URL;
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
🎯 鸿蒙文档抓取工具

用法:
  pnpm start [选项]

选项:
  -i, --incremental        增量抓取模式（保留已存在的文件，跳过已抓取的页面）
  -d, --dry-run            Dry-run 模式（仅列出链接，不进行抓取）
  -s, --stage <stage>      执行阶段：extract（提取链接）、scrape（抓取页面）、index（生成索引）、all（默认）
  -o, --output <dir>       指定输出目录（默认: docs）
  -u, --url <url>          指定起始 URL
  -h, --help               显示帮助信息

阶段说明:
  extract  - 阶段1：访问起始页面，提取所有链接并保存到 links.json
  scrape   - 阶段2：从 links.json 读取链接并抓取页面
  index    - 基于 links.json 生成 docs/index.html 索引页
  all      - 完整流程：提取链接并立即抓取（默认）

示例:
  pnpm start                          # 完整流程（提取+抓取）
  pnpm start --stage extract          # 仅提取链接
  pnpm start --stage scrape           # 仅抓取页面（需要先运行 extract）
  pnpm start --stage extract --dry-run # 提取链接（Dry-run 模式）
  pnpm start --incremental            # 增量抓取
  pnpm start -s scrape -i             # 增量抓取模式（从已有链接文件）
      `);
      process.exit(0);
    }
  }

  return config;
}

async function main() {
  const config = parseArgs();

  console.log('🎯 鸿蒙文档抓取工具');
  console.log(
    '起始 URL:',
    Array.isArray(config.startUrl) ? config.startUrl.join(', ') : config.startUrl
  );
  console.log('输出目录:', config.outputDir);
  console.log('执行阶段:', config.stage);
  if (config.dryRun) {
    console.log('模式: Dry-run（仅列出链接）');
  } else {
    console.log('抓取模式:', config.incremental ? '增量抓取' : '全量抓取');
  }
  console.log('');

  const scraper = new HarmonyDocsScraper(
    config.startUrl,
    config.outputDir,
    config.incremental,
    config.dryRun,
    config.stage
  );

  try {
    await scraper.scrapeAll();
  } catch (error) {
    console.error('程序执行失败:', error);
    process.exit(1);
  }
}

main();
