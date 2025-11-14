import HarmonyDocsScraper from './scraper.js';

const START_URL = 'https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/application-dev-guide';
const OUTPUT_DIR = 'output';

async function main() {
  console.log('🎯 鸿蒙文档抓取工具');
  console.log('起始 URL:', START_URL);
  console.log('输出目录:', OUTPUT_DIR);
  console.log('');

  const scraper = new HarmonyDocsScraper(START_URL, OUTPUT_DIR);
  
  try {
    await scraper.scrapeAll();
  } catch (error) {
    console.error('程序执行失败:', error);
    process.exit(1);
  }
}

main();

