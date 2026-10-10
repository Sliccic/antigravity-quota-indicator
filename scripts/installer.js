/**
 * Cross-Platform Installer for Antigravity Model Quota Indicator
 * 跨平台智能安装器（支持 Windows / macOS / Linux，支持零重启热注入与退出自动替换）
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
      const out = execSync('tasklist /FI "IMAGENAME eq antigravity.exe"', { encoding: 'utf8' });
      return out.toLowerCase().includes('antigravity.exe');
    } else {
      const out = execSync('pgrep -i antigravity', { encoding: 'utf8' });
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
  const stagedPath = path.join(asarDir, 'app.asar.staged');

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

  // 寻找适合注入的 JS 文件
  const widgetCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'quota-widget.js'), 'utf8');
  const injectionWrapper = `\n\n// --- Antigravity Quota Indicator Injection Start ---\n${widgetCode}\n// --- Antigravity Quota Indicator Injection End ---\n`;

  let patched = false;
  // 查找候选入口
  const candidateEntries = [
    path.join(tempExtractDir, 'dist', 'main.js'),
    path.join(tempExtractDir, 'out', 'main.js'),
    path.join(tempExtractDir, 'index.js'),
    path.join(tempExtractDir, 'dist', 'index.js')
  ];

  // 遍历寻找包含 HTML 或 webContents 的入口
  for (const entry of candidateEntries) {
    if (fs.existsSync(entry)) {
      let content = fs.readFileSync(entry, 'utf8');
      if (!content.includes('initModelQuotaWidget')) {
        // 在 loadURL 或 did-finish-load 处注入，或直接作为 preload 附着
        fs.appendFileSync(entry, injectionWrapper);
        patched = true;
        break;
      }
    }
  }

  // 如果找不到明确入口，搜索任意 .html 模板注入 <script>
  if (!patched) {
    function walkHtml(dir) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
          walkHtml(full);
        } else if (f.endsWith('.html')) {
          let html = fs.readFileSync(full, 'utf8');
          if (!html.includes('initModelQuotaWidget')) {
            html = html.replace('</body>', `<script>${widgetCode}</script></body>`);
            fs.writeFileSync(full, html, 'utf8');
            patched = true;
          }
        }
      }
    }
    walkHtml(tempExtractDir);
  }

  console.log('🔄 [4/4] 重新打包资源包...');
  const targetOutput = isProcessRunning() ? stagedPath : asarPath;
  try {
    execSync(`npx --yes @electron/asar pack "${tempExtractDir}" "${targetOutput}"`, { stdio: 'pipe' });
  } catch (e) {
    console.error('❌ 打包 ASAR 失败:', e.message);
    process.exit(1);
  } finally {
    try {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    } catch (_) {}
  }

  if (targetOutput === stagedPath) {
    console.log(`✨ [无损预注入] 客户端当前正在运行，补丁包已生成为: ${stagedPath}`);
    console.log('✨ 挂载退出自动原子替换守护...');
    // 启动后台轮询进程，当 antigravity 退出时原子 rename
    const daemonScript = `
      const fs = require('fs');
      const { execSync } = require('child_process');
      setInterval(() => {
        try {
          const out = execSync('tasklist /FI "IMAGENAME eq antigravity.exe"', { encoding: 'utf8' });
          if (!out.toLowerCase().includes('antigravity.exe')) {
            if (fs.existsSync('${stagedPath.replace(/\\/g, '\\\\')}')) {
              fs.copyFileSync('${stagedPath.replace(/\\/g, '\\\\')}', '${asarPath.replace(/\\/g, '\\\\')}');
              fs.unlinkSync('${stagedPath.replace(/\\/g, '\\\\')}');
            }
            process.exit(0);
          }
        } catch(_) {}
      }, 1000);
    `;
    const tmpDaemon = path.join(os.tmpdir(), `agy_quota_daemon_${Date.now()}.js`);
    fs.writeFileSync(tmpDaemon, daemonScript, 'utf8');
    const child = require('child_process').spawn('node', [tmpDaemon], { detached: true, stdio: 'ignore' });
    child.unref();

    console.log('⚡ 正在尝试即时热注入当前运行窗口...');
    try {
      await hotInject();
    } catch (err) {
      console.log('   (提示: 您也可以正常重启客户端以使补丁永久生效)');
    }
  } else {
    console.log('🎉 安装完成！下次启动 Antigravity 客户端即可呈现模型余量指示器。');
  }
}

if (require.main === module) {
  install().catch(err => {
    console.error('❌ 安装过程发生异常:', err);
    process.exit(1);
  });
}

module.exports = { install, findAsarPath };
