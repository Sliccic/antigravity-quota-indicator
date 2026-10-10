#!/usr/bin/env node

/**
 * Antigravity Quota Indicator CLI
 */

const { install } = require('../scripts/installer');
const { hotInject } = require('../scripts/hot-inject');
const { restore } = require('../scripts/restore');

const command = process.argv[2] || 'install';

async function main() {
  switch (command) {
    case 'install':
      await install();
      break;
    case 'hot-inject':
    case 'hot-reload':
    case 'inject':
      await hotInject();
      break;
    case 'restore':
    case 'uninstall':
      restore();
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log(`
Antigravity Model Quota Indicator CLI
使用方法:
  npx antigravity-quota-indicator install      # 安装并注入补丁包
  npx antigravity-quota-indicator hot-reload   # 零重启热注入到运行中窗口
  npx antigravity-quota-indicator restore      # 卸载并恢复官方原版
      `);
      break;
    default:
      console.error(`未知命令: ${command}，输入 --help 查看支持命令。`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
