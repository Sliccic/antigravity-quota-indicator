/**
 * Restore Original Antigravity asar (Uninstall)
 * 一键卸载与官方基准复原
 */

const fs = require('fs');
const path = require('path');
const { findAsarPath } = require('./installer');

function restore() {
  const asarPath = findAsarPath();
  if (!asarPath) {
    console.error('❌ 未找到 app.asar 路径。');
    process.exit(1);
  }

  const asarDir = path.dirname(asarPath);
  const backupPath = path.join(asarDir, 'app.asar.bak');
  const stagedPath = path.join(asarDir, 'app.asar.staged');

  if (fs.existsSync(stagedPath)) {
    fs.unlinkSync(stagedPath);
    console.log('🗑️ 已清理暂存更新包: app.asar.staged');
  }

  if (fs.existsSync(backupPath)) {
    try {
      fs.copyFileSync(backupPath, asarPath);
      console.log(`✅ 已成功从官方备份复原纯净 app.asar！`);
      console.log('💡 重启 Antigravity 客户端后将恢复出厂初始状态。');
    } catch (e) {
      console.error(`❌ 复原失败 (文件可能被占用，请先退出 Antigravity 客户端后再试):`, e.message);
      process.exit(1);
    }
  } else {
    console.warn('⚠️ 未找到 app.asar.bak 原始备份文件，无需复原。');
  }
}

if (require.main === module) {
  restore();
}

module.exports = { restore };
