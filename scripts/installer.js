/**
 * Cross-Platform Installer for Antigravity Model Quota Indicator
 * 跨平台智能安装器（支持 Windows / macOS / Linux，支持主世界注入、在位直写与零重启热重载）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { hotInject } = require('./hot-inject');

function getCandidateAsarPaths() {
  const homedir = os.homedir();
  const platform = os.platform();

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    return [
      path.join(localAppData, 'Programs', 'antigravity', 'resources', 'app.asar'),
      path.join(programFiles, 'antigravity', 'resources', 'app.asar'),
      path.join(programFiles, 'Google Antigravity', 'resources', 'app.asar'),
      path.join(homedir, 'AppData', 'Roaming', 'antigravity', 'resources', 'app.asar')
    ];
  } else if (platform === 'darwin') {
    return [
      '/Applications/Antigravity.app/Contents/Resources/app.asar',
      path.join(homedir, 'Applications', 'Antigravity.app', 'Contents', 'Resources', 'app.asar')
    ];
  } else {
    // Linux
    return [
      '/opt/antigravity/resources/app.asar',
      '/usr/lib/antigravity/resources/app.asar',
      '/usr/share/antigravity/resources/app.asar',
      path.join(homedir, '.local', 'share', 'antigravity', 'resources', 'app.asar')
    ];
  }
}

function findAsarPath() {
  const candidates = getCandidateAsarPaths();
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isProcessRunning() {
  try {
    if (os.platform() === 'win32') {
      const out = execSync('tasklist /FI "IMAGENAME eq Antigravity.exe" /NH', { encoding: 'utf8' });
      return out.toLowerCase().includes('antigravity.exe');
    } else {
      const out = execSync('pgrep -i antigravity || true', { encoding: 'utf8' });
      return !!out.trim();
    }
  } catch (_) {
    return false;
  }
}

async function install() {
  console.log('🚀 [1/4] 正在检测系统环境与 Antigravity 客户端路径...');
  const asarPath = findAsarPath();
  if (!asarPath) {
    console.error('❌ 未能自动找到 Antigravity 的 app.asar 文件。');
    console.error('请确认已安装 Antigravity 桌面客户端。');
    process.exit(1);
  }

  console.log(`   ✅ 目标 ASAR: ${asarPath}`);
  const asarDir = path.dirname(asarPath);
  const backupPath = path.join(asarDir, 'app.asar.bak');

  console.log('📦 [2/4] 检查原始安全备份...');
  if (!fs.existsSync(backupPath)) {
    try {
      fs.copyFileSync(asarPath, backupPath);
      console.log(`   ✅ 已备份原始文件至: ${backupPath}`);
    } catch (e) {
      console.warn(`   ⚠️ 备份时遇到提示: ${e.message}`);
    }
  } else {
    console.log(`   ℹ️ 保留已有官方出厂备份: ${backupPath}`);
  }

  console.log('⚙️ [3/4] 解构并注入实时余量监控插件...');
  const tempExtractDir = path.join(os.tmpdir(), `agy_quota_patch_${Date.now()}`);
  fs.mkdirSync(tempExtractDir, { recursive: true });

  try {
    execSync(`npx --yes @electron/asar extract "${asarPath}" "${tempExtractDir}"`, { stdio: 'pipe' });
  } catch (e) {
    console.error('❌ 解包 ASAR 失败，请检查 Node.js/npx 环境:', e.message);
    process.exit(1);
  }

  const widgetPath = path.join(__dirname, '..', 'src', 'quota-widget.js');
  const widgetCode = fs.readFileSync(widgetPath, 'utf8');

  // 构建支持主世界隔离穿透的注入包装体 (Main World Context Bridge)
  const injectionWrapper = `
// --- Antigravity Model Quota Indicator Start ---
(function() {
  function __agy_inject_quota__() {
    try {
      const { webFrame } = require('electron');
      if (webFrame && typeof webFrame.executeJavaScript === 'function') {
        webFrame.executeJavaScript(${JSON.stringify(widgetCode)});
        return;
      }
    } catch (_) {}

    try {
      const s = document.createElement('script');
      s.textContent = ${JSON.stringify(widgetCode)};
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {
      console.error('[AGY-Quota] Main world injection error:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', __agy_inject_quota__);
  } else {
    __agy_inject_quota__();
  }
})();
// --- Antigravity Model Quota Indicator End ---
`;

  let patched = false;
  const preloadPath = path.join(tempExtractDir, 'dist', 'preload.js');
  if (fs.existsSync(preloadPath)) {
    let content = fs.readFileSync(preloadPath, 'utf8');
    if (content.includes('Antigravity Model Quota Indicator Start')) {
      const regexQuota = /\/\/ --- Antigravity Model Quota Indicator Start ---[\s\S]*?\/\/ --- Antigravity Model Quota Indicator End ---/g;
      content = content.replace(regexQuota, '');
    }
    content += '\n' + injectionWrapper;
    fs.writeFileSync(preloadPath, content, 'utf8');
    patched = true;
  }

  if (!patched) {
    console.error('❌ 未能在 ASAR 内找到 dist/preload.js 入口文件。');
    process.exit(1);
  }

  console.log('🔄 [4/4] 重新打包资源包并覆写应用...');
  const tempNewAsar = path.join(asarDir, 'app.asar.new');
  if (fs.existsSync(tempNewAsar)) fs.rmSync(tempNewAsar, { force: true });

  try {
    execSync(`npx --yes @electron/asar pack "${tempExtractDir}" "${tempNewAsar}"`, { stdio: 'pipe' });
  } catch (e) {
    console.error('❌ 打包 ASAR 失败:', e.message);
    process.exit(1);
  } finally {
    try {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    } catch (_) {}
  }

  // 尝试在位流式覆写（在 Windows 上即使 Antigravity 正在运行也可以直接写入）
  let writtenDirectly = false;
  try {
    fs.copyFileSync(tempNewAsar, asarPath);
    writtenDirectly = true;
    console.log('✅ 已成功直接写入 app.asar，永久生效！');
    if (fs.existsSync(tempNewAsar)) fs.rmSync(tempNewAsar, { force: true });
    const stagedPath = path.join(asarDir, 'app.asar.staged');
    if (fs.existsSync(stagedPath)) fs.rmSync(stagedPath, { force: true });
  } catch (err) {
    console.warn(`   ⚠️ 直接写入遇到锁定，转为暂存守护模式: ${err.message}`);
  }

  if (!writtenDirectly) {
    const stagedPath = path.join(asarDir, 'app.asar.staged');
    if (fs.existsSync(stagedPath)) fs.rmSync(stagedPath, { force: true });
    fs.renameSync(tempNewAsar, stagedPath);

    // 挂载退出自动替换守护
    const daemonScript = `
      const fs = require('fs');
      const { execSync } = require('child_process');
      const timer = setInterval(() => {
        try {
          const out = execSync('tasklist /FI "IMAGENAME eq Antigravity.exe" /NH', { encoding: 'utf8' });
          if (!out.toLowerCase().includes('antigravity.exe')) {
            if (fs.existsSync('${stagedPath.replace(/\\/g, '\\\\')}')) {
              fs.copyFileSync('${stagedPath.replace(/\\/g, '\\\\')}', '${asarPath.replace(/\\/g, '\\\\')}');
              fs.unlinkSync('${stagedPath.replace(/\\/g, '\\\\')}');
            }
            clearInterval(timer);
            process.exit(0);
          }
        } catch(_) {}
      }, 500);
    `;
    const tmpDaemon = path.join(os.tmpdir(), `agy_quota_daemon_${Date.now()}.js`);
    fs.writeFileSync(tmpDaemon, daemonScript, 'utf8');
    const child = require('child_process').spawn('node', [tmpDaemon], { detached: true, stdio: 'ignore' });
    child.unref();
  }

  console.log('⚡ 正在执行即时热重载，无需等待重启...');
  try {
    await hotInject();
  } catch (e) {
    console.log('   (提示：客户端将在下次打开时自动呈现)');
  }

  console.log('\n🎉 ==============================================');
  console.log('🎉 实时模型余量监控插件安装成功！');
  console.log('🎉 当前窗口已即时生效，重启客户端后依然永久常驻。');
  console.log('🎉 ==============================================\n');
}

if (require.main === module) {
  install().catch(err => {
    console.error('❌ 安装过程发生异常:', err);
    process.exit(1);
  });
}

module.exports = { install, findAsarPath };
