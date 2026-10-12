/**
 * Antigravity Real-Time Model Quota & Session Task Execution Timer Widget
 * 实时模型余量 & 当前会话任务执行计时器 - 常驻顶部标题栏
 * 
 * 核心特性：
 * 1. 顶部标题栏微型双胶囊：模型余量胶囊 + 当前会话任务计时胶囊
 * 2. 精准绑定【当前会话窗口】：多窗口/多会话并发时，各自独立准确显示当前窗口的任务状态与耗时
 * 3. 悬浮窗详情包含：大号实时秒表、输出 Tokens、缓存命中 (Cache Hit)、输入 Tokens、步骤数与当前操作
 * 4. 0 占用主编辑区与会话区水平宽度，悬停即看，点击锁定，随手点击外部即刻收起
 */
(function initModelQuotaAndTaskWidget() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // 清理旧实例与旧 DOM 节点，确保热更新无缝生效
  const removeEl = (id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  };
  removeEl('agy-chat-quota-badge');
  removeEl('agy-model-quota-topbar');
  removeEl('agy-quota-popover');
  removeEl('agy-task-timer-topbar');
  removeEl('agy-task-popover');

  if (window.__AGY_MODEL_QUOTA_WIDGET_INITIALIZED__) {
    if (window.__AGY_QUOTA_CLEANUP__) {
      try { window.__AGY_QUOTA_CLEANUP__(); } catch (_) {}
    }
  }

  // 唯一实例 ID 守卫：使旧实例在下一次循环时自动静默退出，彻底根除多版本/旧闭包争抢 DOM
  const WIDGET_INSTANCE_ID = 'agy_inst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  window.__AGY_ACTIVE_INSTANCE_ID__ = WIDGET_INSTANCE_ID;

  if (window.__AGY_TASK_TICK_TIMER__) {
    clearInterval(window.__AGY_TASK_TICK_TIMER__);
    window.__AGY_TASK_TICK_TIMER__ = null;
  }
  if (window.__AGY_TASK_POLL_TIMER__) {
    clearInterval(window.__AGY_TASK_POLL_TIMER__);
    window.__AGY_TASK_POLL_TIMER__ = null;
  }

  window.__AGY_MODEL_QUOTA_WIDGET_INITIALIZED__ = true;

  // 采用与图二完全一致的 Antigravity 原生字体栈（完美适配 Windows Consolas 与现代等宽无衬线体，去除内部双引号避免属性破坏）
  const FONT_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  const FONT_MONO = 'Consolas, ui-monospace, SFMono-Regular, Menlo, monospace';
  const FONT_NUM = 'Consolas, ui-monospace, SFMono-Regular, Menlo, monospace';

  // 注入微型柔和呼吸动效样式
  if (typeof document !== 'undefined' && !document.getElementById('agy-pulse-style')) {
    const s = document.createElement('style');
    s.id = 'agy-pulse-style';
    s.textContent = `
      @keyframes agy-pulse-dot {
        0%, 100% { opacity: 0.85; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.12); box-shadow: 0 0 7px rgba(34,197,94,0.9); }
      }
    `;
    document.head.appendChild(s);
  }

  // 用户持久化配置
  const CONFIG_STORAGE_KEY = 'agy_quota_widget_config_v2';
  const DEFAULT_CONFIG = {
    triggerMode: 'hover',     // 余额卡片展开: 'click' | 'hover'
    taskTriggerMode: 'hover', // 任务卡片展开: 'click' | 'hover'
    refreshInterval: 60,      // 秒数: 30, 60, 120, 300, 0 (手动)
    timeStyle: 'zh'           // 'zh' (？小时？分钟) | 'en' (?h ?m)
  };

  let config = loadConfig();

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (raw) return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
    } catch (_) {}
    return Object.assign({}, DEFAULT_CONFIG);
  }

  function saveQuotaConfig(newCfg) {
    config = Object.assign({}, config, newCfg);
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch (_) {}
    setupPollingTimer();
    // 仅针对余额部分进行重绘，决不干扰正在运行的任务计时胶囊与秒表
    const parsedQuota = parseQuota(quotaData);
    updateQuotaTopPill(parsedQuota);
    renderQuotaPopoverContent(parsedQuota);
  }

  // =========================================================================
  // 1. 模型配额逻辑
  // =========================================================================
  let quotaData = null;
  let isFetchingQuota = false;
  let lastQuotaFetchTime = 0;
  let pollIntervalTimer = null;
  let hideQuotaPopoverTimer = null;
  let isQuotaPopoverPinned = false;
  let currentCardView = 'quota'; // 'quota' | 'settings'

  async function fetchQuota(force = false) {
    if (isFetchingQuota && !force) return quotaData;
    const now = Date.now();
    if (!force && quotaData && now - lastQuotaFetchTime < 4000) {
      return quotaData;
    }

    const csrfToken = window.__APP_CONFIG__?.csrfToken;
    if (!csrfToken) return null;

    try {
      isFetchingQuota = true;
      const res = await fetch('/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrfToken
        },
        body: JSON.stringify({})
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      quotaData = json;
      lastQuotaFetchTime = Date.now();
      return json;
    } catch (err) {
      console.warn('[ModelQuotaWidget] Fetch quota failed:', err);
      return null;
    } finally {
      isFetchingQuota = false;
    }
  }

  function parseQuota(data) {
    if (!data) return null;
    const groups = data?.response?.groups || data?.groups || (Array.isArray(data) ? data : null);
    if (!groups || !Array.isArray(groups)) return null;

    const gemini = groups.find(g => g.displayName?.includes('Gemini')) || groups[0];
    const g5h = gemini?.buckets?.find(b => b.window === '5h');
    const gW = gemini?.buckets?.find(b => b.window === 'weekly');

    const tp = groups.find(g => g.displayName?.includes('Claude') || g.displayName?.includes('3p'));
    const t5h = tp?.buckets?.find(b => b.window === '5h');
    const tW = tp?.buckets?.find(b => b.window === 'weekly');

    const getFrac = (b) => {
      if (!b) return 100;
      const f = b.remainingFraction ?? b.fraction;
      return typeof f === 'number' ? Math.round(f * 100) : 100;
    };

    return {
      gemini: {
        name: gemini?.displayName || 'Gemini 模型',
        desc: gemini?.description || 'Pro & Flash 共享',
        p5h: getFrac(g5h),
        pW: getFrac(gW),
        reset5h: g5h?.resetTime,
        resetW: gW?.resetTime
      },
      thirdParty: tp ? {
        name: tp.displayName || 'Claude 与 GPT 模型',
        desc: tp.description || '第三方模型',
        p5h: getFrac(t5h),
        pW: getFrac(tW),
        reset5h: t5h?.resetTime,
        resetW: tW?.resetTime
      } : null
    };
  }

  function format5hReset(isoStr, style) {
    if (!isoStr) return '-';
    const diffMs = new Date(isoStr).getTime() - Date.now();
    if (diffMs <= 0) return style === 'zh' ? '即将重置' : 'Resetting';
    const totalMin = Math.ceil(diffMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0 && m === 0) return style === 'zh' ? '即将重置' : 'Resetting';
    if (style === 'en') return h > 0 ? `${h}h ${m}m` : `${m}m`;
    return h > 0 ? `${h}小时${m}分钟` : `${m}分钟`;
  }

  function formatWeeklyReset(isoStr, style) {
    if (!isoStr) return '-';
    const diffMs = new Date(isoStr).getTime() - Date.now();
    if (diffMs <= 0) return style === 'zh' ? '即将重置' : 'Resetting';
    const totalHours = Math.floor(diffMs / 3600000);
    const d = Math.floor(totalHours / 24);
    const h = totalHours % 24;
    if (d === 0 && h === 0) return style === 'zh' ? '< 1小时' : '< 1h';
    if (style === 'en') return d > 0 ? `${d}d ${h}h` : `${h}h`;
    return d > 0 ? `${d}天${h}小时` : `${h}小时`;
  }

  function getStatusColor(pct) {
    if (pct > 50) return '#10b981';
    if (pct > 20) return '#f59e0b';
    return '#ef4444';
  }

  function getOrCreateQuotaPopover() {
    let popover = document.getElementById('agy-quota-popover');
    if (!popover) {
      popover = document.createElement('div');
      popover.id = 'agy-quota-popover';
      popover.style.cssText = [
        '-webkit-app-region: no-drag !important',
        'app-region: no-drag !important',
        'position: fixed',
        'z-index: 999999',
        'width: 325px',
        'background: rgba(22, 23, 27, 0.92)',
        'border: 1px solid var(--border, rgba(255,255,255,0.15))',
        'border-radius: 12px',
        'box-shadow: 0 20px 48px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.3)',
        'padding: 14px',
        'font-size: 12px',
        'color: var(--foreground, #e5e7eb)',
        'backdrop-filter: blur(14px)',
        '-webkit-backdrop-filter: blur(14px)',
        'display: none',
        'opacity: 0',
        'transform: translateY(-6px)',
        'transition: opacity 0.18s ease, transform 0.18s ease',
        'pointer-events: auto',
        'font-family: ' + FONT_SANS
      ].join(';');

      popover.addEventListener('mouseenter', () => {
        if (hideQuotaPopoverTimer) clearTimeout(hideQuotaPopoverTimer);
      });
      popover.addEventListener('mouseleave', () => {
        if (currentCardView === 'settings' || isQuotaPopoverPinned) return;
        if (config.triggerMode === 'hover') scheduleHideQuotaPopover();
      });
      popover.addEventListener('click', (e) => e.stopPropagation());
      document.body.appendChild(popover);
    }
    return popover;
  }

  function openQuotaPopover(targetElement, pin = false) {
    closeTaskPopover();
    if (hideQuotaPopoverTimer) clearTimeout(hideQuotaPopoverTimer);
    if (pin) isQuotaPopoverPinned = true;

    const popover = getOrCreateQuotaPopover();
    const rect = targetElement.getBoundingClientRect();
    popover.style.display = 'block';
    const left = Math.max(12, Math.min(window.innerWidth - 345, rect.left));
    const top = rect.bottom + 6;
    popover.style.top = top + 'px';
    popover.style.left = left + 'px';
    popover.style.opacity = '1';
    popover.style.transform = 'translateY(0)';
    targetElement.style.background = 'var(--secondary, rgba(255,255,255,0.12))';
  }

  function closeQuotaPopover() {
    isQuotaPopoverPinned = false;
    currentCardView = 'quota';
    const popover = document.getElementById('agy-quota-popover');
    const pill = document.getElementById('agy-model-quota-topbar');
    if (pill) pill.style.background = 'var(--card, rgba(255,255,255,0.06))';
    if (!popover) return;

    popover.style.opacity = '0';
    popover.style.transform = 'translateY(-6px)';
    setTimeout(() => {
      if (!isQuotaPopoverPinned && popover.style.opacity === '0') {
        popover.style.display = 'none';
      }
    }, 180);
  }

  function scheduleHideQuotaPopover() {
    if (isQuotaPopoverPinned || currentCardView === 'settings') return;
    if (hideQuotaPopoverTimer) clearTimeout(hideQuotaPopoverTimer);
    hideQuotaPopoverTimer = setTimeout(() => {
      if (!isQuotaPopoverPinned && currentCardView !== 'settings') closeQuotaPopover();
    }, 220);
  }

  function renderQuotaPopoverContent(parsed) {
    const popover = getOrCreateQuotaPopover();
    if (!parsed) {
      popover.innerHTML = '<div style="opacity:0.7;text-align:center;padding:12px;">正在加载模型配额...</div>';
      return;
    }
    if (currentCardView === 'settings') {
      renderSettingsView(popover);
    } else {
      renderQuotaView(popover, parsed);
    }
  }

  function renderQuotaView(popover, parsed) {
    const g = parsed.gemini;
    const tp = parsed.thirdParty;
    const style = config.timeStyle;
    const g5hText = format5hReset(g.reset5h, style);
    const gWText = formatWeeklyReset(g.resetW, style);

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);font-family:${FONT_SANS};">
        <div style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px;color:#f8fafc;">
          <span>⚡ 模型用量与配额</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button id="agy-quota-refresh-action" title="立即刷新配额" style="-webkit-app-region:no-drag;cursor:pointer;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:var(--foreground,#fff);font-size:11px;padding:3px 8px;border-radius:6px;display:flex;align-items:center;gap:3px;transition:background 0.2s;font-family:${FONT_SANS};">
            🔄 刷新
          </button>
          <button id="agy-quota-settings-action" title="插件参数设置" style="-webkit-app-region:no-drag;cursor:pointer;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:var(--foreground,#fff);font-size:11px;padding:3px 8px;border-radius:6px;display:flex;align-items:center;gap:3px;transition:background 0.2s;font-family:${FONT_SANS};">
            ⚙️ 设置
          </button>
        </div>
      </div>

      <!-- Gemini Section -->
      <div style="margin-bottom:12px;font-family:${FONT_SANS};">
        <div style="font-weight:500;color:var(--foreground,#fff);margin-bottom:6px;display:flex;justify-content:space-between;">
          <span>${g.name}</span>
          <span style="font-size:11px;opacity:0.6;">Pro & Flash 共享</span>
        </div>
        <div style="margin-bottom:7px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;opacity:0.85;">
            <span>${style === 'zh' ? '5小时限额' : '5-Hour Limit'}</span>
            <span><strong style="color:${getStatusColor(g.p5h)};font-family:${FONT_SANS};font-variant-numeric:tabular-nums;font-weight:700;">${g.p5h}<span style="font-size:10px;font-weight:normal;opacity:0.85;margin-left:0.5px;">%</span></strong> · <span style="font-family:${FONT_NUM};font-variant-numeric:tabular-nums;">${g5hText}</span></span>
          </div>
          <div style="height:5px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
            <div style="width:${g.p5h}%;height:100%;background:${getStatusColor(g.p5h)};border-radius:3px;transition:width 0.3s ease;"></div>
          </div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;opacity:0.85;">
            <span>${style === 'zh' ? '七天限额' : 'Weekly Limit'}</span>
            <span><strong style="color:${getStatusColor(g.pW)};font-family:${FONT_SANS};font-variant-numeric:tabular-nums;font-weight:700;">${g.pW}<span style="font-size:10px;font-weight:normal;opacity:0.85;margin-left:0.5px;">%</span></strong> · <span style="font-family:${FONT_NUM};font-variant-numeric:tabular-nums;">${gWText}</span></span>
          </div>
          <div style="height:5px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
            <div style="width:${g.pW}%;height:100%;background:${getStatusColor(g.pW)};border-radius:3px;transition:width 0.3s ease;"></div>
          </div>
        </div>
      </div>
    `;

    if (tp) {
      const tp5hText = format5hReset(tp.reset5h, style);
      const tpWText = formatWeeklyReset(tp.resetW, style);
      html += `
        <div style="padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);margin-bottom:8px;font-family:${FONT_SANS};">
          <div style="font-weight:500;color:var(--foreground,#fff);margin-bottom:6px;display:flex;justify-content:space-between;">
            <span>${tp.name}</span>
            <span style="font-size:11px;opacity:0.6;">第三方模型</span>
          </div>
          <div style="margin-bottom:7px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;opacity:0.85;">
              <span>${style === 'zh' ? '5小时限额' : '5-Hour Limit'}</span>
              <span><strong style="color:${getStatusColor(tp.p5h)};font-family:${FONT_SANS};font-variant-numeric:tabular-nums;font-weight:700;">${tp.p5h}<span style="font-size:10px;font-weight:normal;opacity:0.85;margin-left:0.5px;">%</span></strong> · <span style="font-family:${FONT_NUM};font-variant-numeric:tabular-nums;">${tp5hText}</span></span>
            </div>
            <div style="height:5px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
              <div style="width:${tp.p5h}%;height:100%;background:${getStatusColor(tp.p5h)};border-radius:3px;transition:width 0.3s ease;"></div>
            </div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;opacity:0.85;">
              <span>${style === 'zh' ? '七天限额' : 'Weekly Limit'}</span>
              <span><strong style="color:${getStatusColor(tp.pW)};font-family:${FONT_SANS};font-variant-numeric:tabular-nums;font-weight:700;">${tp.pW}<span style="font-size:10px;font-weight:normal;opacity:0.85;margin-left:0.5px;">%</span></strong> · <span style="font-family:${FONT_NUM};font-variant-numeric:tabular-nums;">${tpWText}</span></span>
            </div>
            <div style="height:5px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
              <div style="width:${tp.pW}%;height:100%;background:${getStatusColor(tp.pW)};border-radius:3px;transition:width 0.3s ease;"></div>
            </div>
          </div>
        </div>
      `;
    }

    const intervalLabel = config.refreshInterval === 0 ? '已关闭自动同步' : `每 ${config.refreshInterval} 秒自动同步`;
    const triggerLabel = config.triggerMode === 'click' ? '单击切换展开' : '悬停快速预览 (单击常开)';

    html += `
      <div style="margin-top:10px;padding-top:6px;font-size:10px;opacity:0.5;display:flex;justify-content:space-between;">
        <span>${triggerLabel}</span>
        <span>${intervalLabel}</span>
      </div>
    `;

    popover.innerHTML = html;

    const refBtn = popover.querySelector('#agy-quota-refresh-action');
    if (refBtn) {
      refBtn.onclick = async (e) => {
        e.stopPropagation();
        refBtn.textContent = '⏳ 同步中...';
        await refreshAll(true);
      };
    }

    const setBtn = popover.querySelector('#agy-quota-settings-action');
    if (setBtn) {
      setBtn.onclick = (e) => {
        e.stopPropagation();
        currentCardView = 'settings';
        isQuotaPopoverPinned = true;
        renderSettingsView(popover);
      };
    }
  }

  function renderSettingsView(popover) {
    const isClick = config.triggerMode === 'click';
    const isHover = config.triggerMode === 'hover';
    const isZh = config.timeStyle === 'zh';
    const isEn = config.timeStyle === 'en';

    const activeBtnStyle = 'background:var(--primary, #3b82f6);color:#fff;border:1px solid transparent;font-weight:600;box-shadow: 0 1px 3px rgba(0,0,0,0.3);';
    const normalBtnStyle = 'background:rgba(255,255,255,0.06);color:var(--foreground,#e5e7eb);border:1px solid rgba(255,255,255,0.1);font-weight:normal;';

    const html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <button id="agy-settings-back" style="-webkit-app-region:no-drag;cursor:pointer;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:var(--foreground,#fff);font-size:11px;padding:3px 8px;border-radius:6px;display:flex;align-items:center;gap:4px;">
          ← 返回
        </button>
        <span style="font-weight:600;font-size:13px;">⚙️ 模型余量设置</span>
        <span style="width:36px;"></span>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;font-size:12px;">
        <div>
          <div style="font-weight:500;margin-bottom:6px;opacity:0.9;display:flex;justify-content:space-between;">
            <span>余量面板展开触发方式</span>
            <span style="font-size:10px;opacity:0.5;">${isClick ? '当前: 单击' : '当前: 悬停'}</span>
          </div>
          <div style="display:flex;gap:6px;">
            <button id="opt-trigger-click" style="flex:1;padding:6px 8px;border-radius:6px;font-size:11px;cursor:pointer;-webkit-app-region:no-drag;transition:all 0.15s;${isClick ? activeBtnStyle : normalBtnStyle}">
              👆 单击展开
            </button>
            <button id="opt-trigger-hover" style="flex:1;padding:6px 8px;border-radius:6px;font-size:11px;cursor:pointer;-webkit-app-region:no-drag;transition:all 0.15s;${isHover ? activeBtnStyle : normalBtnStyle}">
              🖱️ 悬停展开
            </button>
          </div>
        </div>

        <div>
          <div style="font-weight:500;margin-bottom:6px;opacity:0.9;">余量自动同步周期</div>
          <select id="opt-refresh-select" style="width:100%;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.08);color:var(--foreground,#e5e7eb);border:1px solid rgba(255,255,255,0.15);font-size:11px;cursor:pointer;-webkit-app-region:no-drag;outline:none;">
            <option value="30" ${config.refreshInterval === 30 ? 'selected' : ''}>30 秒</option>
            <option value="60" ${config.refreshInterval === 60 ? 'selected' : ''}>60 秒 (默认推荐)</option>
            <option value="120" ${config.refreshInterval === 120 ? 'selected' : ''}>2 分钟</option>
            <option value="300" ${config.refreshInterval === 300 ? 'selected' : ''}>5 分钟</option>
            <option value="0" ${config.refreshInterval === 0 ? 'selected' : ''}>仅手动刷新 (关闭自动)</option>
          </select>
        </div>

        <div>
          <div style="font-weight:500;margin-bottom:6px;opacity:0.9;display:flex;justify-content:space-between;">
            <span>限额倒计时显示风格</span>
            <span style="font-size:10px;opacity:0.5;">${isZh ? '中文风格' : '英文风格'}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <button id="opt-style-zh" style="text-align:left;padding:7px 10px;border-radius:6px;font-size:11px;cursor:pointer;-webkit-app-region:no-drag;transition:all 0.15s;${isZh ? activeBtnStyle : normalBtnStyle}">
              中文格式: <strong>4小时23分钟</strong> · <strong>5天18小时</strong>
            </button>
            <button id="opt-style-en" style="text-align:left;padding:7px 10px;border-radius:6px;font-size:11px;cursor:pointer;-webkit-app-region:no-drag;transition:all 0.15s;${isEn ? activeBtnStyle : normalBtnStyle}">
              英文格式: <strong>4h 23m</strong> · <strong>5d 18h</strong>
            </button>
          </div>
        </div>
      </div>

      <div style="margin-top:14px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:flex-end;">
        <button id="agy-settings-done" style="-webkit-app-region:no-drag;cursor:pointer;background:var(--primary, #3b82f6);color:#fff;font-size:11px;padding:5px 14px;border-radius:6px;border:none;font-weight:500;">
          保存并返回
        </button>
      </div>
    `;

    popover.innerHTML = html;

    const backBtn = popover.querySelector('#agy-settings-back');
    const doneBtn = popover.querySelector('#agy-settings-done');
    const goBack = () => {
      currentCardView = 'quota';
      const parsed = parseQuota(quotaData);
      renderQuotaView(popover, parsed);
    };
    if (backBtn) backBtn.onclick = goBack;
    if (doneBtn) doneBtn.onclick = goBack;

    const btnClick = popover.querySelector('#opt-trigger-click');
    const btnHover = popover.querySelector('#opt-trigger-hover');
    if (btnClick) {
      btnClick.onclick = (e) => {
        e.stopPropagation();
        saveQuotaConfig({ triggerMode: 'click' });
        renderSettingsView(popover);
      };
    }
    if (btnHover) {
      btnHover.onclick = (e) => {
        e.stopPropagation();
        saveQuotaConfig({ triggerMode: 'hover' });
        renderSettingsView(popover);
      };
    }

    const selectRefresh = popover.querySelector('#opt-refresh-select');
    if (selectRefresh) {
      selectRefresh.onchange = (e) => {
        e.stopPropagation();
        const val = parseInt(selectRefresh.value, 10);
        saveQuotaConfig({ refreshInterval: isNaN(val) ? 60 : val });
      };
    }

    const btnStyleZh = popover.querySelector('#opt-style-zh');
    const btnStyleEn = popover.querySelector('#opt-style-en');
    if (btnStyleZh) {
      btnStyleZh.onclick = (e) => {
        e.stopPropagation();
        saveQuotaConfig({ timeStyle: 'zh' });
        renderSettingsView(popover);
      };
    }
    if (btnStyleEn) {
      btnStyleEn.onclick = (e) => {
        e.stopPropagation();
        saveQuotaConfig({ timeStyle: 'en' });
        renderSettingsView(popover);
      };
    }
  }

  function updateQuotaTopPill(parsed) {
    const topBar = document.querySelector('.bg-sidebar') || document.querySelector('.shrink-0');
    if (!topBar) return;

    let pill = document.getElementById('agy-model-quota-topbar');
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'agy-model-quota-topbar';
      pill.type = 'button';
      pill.style.cssText = [
        '-webkit-app-region: no-drag !important',
        'app-region: no-drag !important',
        'display: inline-flex',
        'align-items: center',
        'gap: 7px',
        'padding: 3px 10px',
        'border-radius: 9999px',
        'background: var(--card, rgba(255,255,255,0.06))',
        'border: 1px solid var(--border, rgba(255,255,255,0.12))',
        'font-size: 12px',
        'color: var(--foreground, #e5e7eb)',
        'cursor: pointer',
        'margin-left: 12px',
        'user-select: none',
        'outline: none',
        'transition: all 0.15s ease',
        'position: relative',
        'z-index: 50'
      ].join(';');

      pill.addEventListener('mouseenter', () => {
        if (config.triggerMode === 'hover') openQuotaPopover(pill, false);
      });
      pill.addEventListener('mouseleave', () => {
        if (config.triggerMode === 'hover') scheduleHideQuotaPopover();
      });
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const popover = document.getElementById('agy-quota-popover');
        const isCurrentlyVisible = popover && popover.style.display === 'block' && popover.style.opacity === '1';
        if (isCurrentlyVisible && isQuotaPopoverPinned) {
          closeQuotaPopover();
        } else {
          openQuotaPopover(pill, true);
          refreshQuotaOnly(true);
        }
      });
      topBar.appendChild(pill);
    }

    if (!parsed) {
      pill.innerHTML = '<span style="opacity:0.6;">⚡ 加载中...</span>';
      return;
    }

    const g = parsed.gemini;
    const minPct = Math.min(g.p5h, g.pW);
    const dotColor = getStatusColor(minPct);
    const labelW = config.timeStyle === 'zh' ? '周' : 'wk';

    pill.style.fontFamily = FONT_SANS;
    pill.innerHTML = `
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dotColor};box-shadow: 0 0 6px ${dotColor}88;"></span>
      <span style="font-weight:500;opacity:0.9;font-family:${FONT_SANS};">Gemini:</span>
      <span style="font-weight:600;color:${g.p5h < 20 ? '#ef4444' : 'var(--primary, #38bdf8)'};font-family:${FONT_SANS};font-variant-numeric:tabular-nums;">${g.p5h}<span style="font-size:10px;font-weight:500;opacity:0.8;margin-left:0.5px;">%</span></span>
      <span style="font-size:10px;opacity:0.55;margin-left:1px;">(5h)</span>
      <span style="opacity:0.3;margin:0 2px;">/</span>
      <span style="font-weight:600;color:${g.pW < 20 ? '#ef4444' : 'var(--accent, #a78bfa)'};font-family:${FONT_SANS};font-variant-numeric:tabular-nums;">${g.pW}<span style="font-size:10px;font-weight:500;opacity:0.8;margin-left:0.5px;">%</span></span>
      <span style="font-size:10px;opacity:0.55;margin-left:1px;">(${labelW})</span>
    `;

    const tip = config.triggerMode === 'click' ? '单击展开/收起详情面板' : '悬停预览，单击常开详情面板';
    pill.title = `Gemini 剩余配额: 5h ${g.p5h}% | 周 ${g.pW}%\n${tip}`;
  }


  // =========================================================================
  // 2. 当前会话窗口任务计时器与 Tokens 统计逻辑
  // =========================================================================
  let currentTaskData = null;
  let isFetchingTask = false;
  let isTaskPopoverPinned = false;
  let hideTaskPopoverTimer = null;
  let activeTaskState = null; // 当前会话的状态信息

  function formatTaskDuration(sec) {
    if (sec < 0 || isNaN(sec)) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return `${pad(h)}:${pad(remM)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  }

  function formatTokens(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    return Number(n).toLocaleString('en-US');
  }

  // 获取所有会话概览
  async function fetchTaskStatus() {
    if (isFetchingTask) return currentTaskData;
    const csrfToken = window.__APP_CONFIG__?.csrfToken;
    if (!csrfToken) return null;

    try {
      isFetchingTask = true;
      const res = await fetch('/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrfToken
        },
        body: JSON.stringify({})
      });
      if (!res.ok) return null;
      const json = await res.json();
      currentTaskData = json;
      return json;
    } catch (err) {
      return null;
    } finally {
      isFetchingTask = false;
    }
  }

  // 精准识别【当前窗口】对应的会话 ID
  function resolveCurrentWindowConversationId(trajectoriesList) {
    if (!trajectoriesList || trajectoriesList.length === 0) return null;
    if (trajectoriesList.length === 1) return trajectoriesList[0].id;

    // 1. 最高优先级：从当前活动窗口的 URL 中提取当前会话 UUID（/c/<uuid>）
    // 在 Antigravity 中，活动聊天窗口的 URL 包含唯一会话 ID，极其可靠且不受焦点或标签切换变动干扰
    try {
      const urlText = (window.location.pathname || '') + ' ' + (window.location.href || '');
      const urlMatch = urlText.match(/\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (urlMatch) {
        const convId = urlMatch[1];
        const found = trajectoriesList.find(t => t.id === convId);
        if (found) return found.id;
      }
    } catch (_) {}

    // 2. 次高优先级：从主聊天工作区 DOM 检测活动会话容器
    const activeChat = document.querySelector('.overflow-y-auto[data-cascade-id], [data-cascade-id].h-full, [data-cascade-id].bg-sidebar-secondary');
    if (activeChat) {
      const cid = activeChat.getAttribute('data-cascade-id');
      if (cid && trajectoriesList.some(t => t.id === cid)) return cid;
    }

    // 3. 匹配 document.title（仅当标题包含会话名称且标题非默认窗口名时）
    const docTitle = document.title || '';
    if (docTitle && !docTitle.startsWith('Antigravity') && !docTitle.includes('Outside of Project')) {
      for (const t of trajectoriesList) {
        const title = t.annotations?.title || t.summary || '';
        if (title && title.length > 1 && docTitle.includes(title)) {
          return t.id;
        }
      }
    }

    // 4. 保底机制：如果之前已经锁定了某个会话且该会话仍在列表中，维持上一状态，绝不随意跳变到其他会话
    if (activeTaskState?.id && trajectoriesList.some(t => t.id === activeTaskState.id)) {
      return activeTaskState.id;
    }

    // 5. 最终保底：取最后浏览时间最新的会话
    const sortedByView = [...trajectoriesList].sort((a, b) => {
      const aView = new Date(a.annotations?.lastUserViewTime || 0).getTime();
      const bView = new Date(b.annotations?.lastUserViewTime || 0).getTime();
      return bView - aView;
    });
    return sortedByView[0]?.id || trajectoriesList[0].id;
  }

  // 本轮 Token 统计缓存 (convId -> { lastModTime, data })，避免重复全量读取 Base64 造成性能与界面卡顿
  const tokenMetricsCache = new Map();

  // 通过 LanguageServer ReadFile 读取指定会话 transcript.jsonl 并计算本轮 Token 统计
  async function fetchTurnTokenMetrics(convId, lastModTime = 0) {
    if (!convId) return null;
    const cacheKey = convId;
    if (lastModTime && tokenMetricsCache.has(cacheKey)) {
      const cached = tokenMetricsCache.get(cacheKey);
      if (cached.lastModTime === lastModTime) {
        return cached.data;
      }
    }
    const csrfToken = window.__APP_CONFIG__?.csrfToken;
    if (!csrfToken) return null;

    try {
      const uri = `file:///C:/Users/HXY/.gemini/antigravity/brain/${convId}/.system_generated/logs/transcript.jsonl`;
      const res = await fetch('/exa.language_server_pb.LanguageServerService/ReadFile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrfToken
        },
        body: JSON.stringify({ uri })
      });
      if (!res.ok) return null;
      const fileData = await res.json();
      if (!fileData?.content) return null;

      const binary = atob(fileData.content);
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      const text = new TextDecoder('utf-8').decode(bytes);
      const lines = text.trim().split('\n').filter(Boolean);

      const steps = [];
      for (const l of lines) {
        try { steps.push(JSON.parse(l)); } catch (_) {}
      }
      if (steps.length === 0) return null;

      let lastUserIdx = -1;
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].type === 'USER_INPUT') {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx === -1) return null;

      const turnSteps = steps.slice(lastUserIdx);
      const lastStep = steps[steps.length - 1];
      const isCompleted = lastStep.type === 'PLANNER_RESPONSE' && (!lastStep.tool_calls || lastStep.tool_calls.length === 0);

      let outTokens = 0;
      let cacheTokens = 0;
      let inTokens = 0;
      for (const s of turnSteps) {
        if (s.output_tokens) outTokens += s.output_tokens;
        if (s.cache_read_tokens) cacheTokens += s.cache_read_tokens;
        if (s.input_tokens) inTokens += s.input_tokens;
      }

      let activeTool = null;
      if (!isCompleted && lastStep.tool_calls && lastStep.tool_calls.length > 0) {
        const tc = lastStep.tool_calls[0];
        activeTool = tc.args?.toolSummary || tc.args?.toolAction || tc.name;
        if (typeof activeTool === 'string') activeTool = activeTool.replace(/^"|"$/g, '');
      }

      const result = {
        turnStepCount: turnSteps.length,
        isCompleted,
        outTokens,
        cacheTokens,
        inTokens,
        activeTool
      };
      tokenMetricsCache.set(cacheKey, { lastModTime, data: result });
      return result;
    } catch (err) {
      return null;
    }
  }

  // 0ms 同步极速提取器：提取当前会话任务元信息与毫秒级时间，绝不被慢速 Token 解析阻塞
  function resolveActiveTaskFast(data) {
    if (!data?.trajectorySummaries) return null;
    const list = Object.entries(data.trajectorySummaries).map(([id, t]) => ({
      id,
      ...t
    }));
    if (list.length === 0) return null;

    // 精准锁定当前窗口所属的会话
    const currentId = resolveCurrentWindowConversationId(list);
    let active = currentId ? list.find(t => t.id === currentId) : null;
    if (!active && activeTaskState?.id) {
      active = list.find(t => t.id === activeTaskState.id);
    }
    if (!active) {
      active = list[0];
    }

    const isRunning = active.status === 'CASCADE_RUN_STATUS_RUNNING';
    const userStartTime = active.lastUserInputTime ? new Date(active.lastUserInputTime).getTime() : 0;
    const lastModTime = active.lastModifiedTime ? new Date(active.lastModifiedTime).getTime() : 0;

    let elapsedSec = 0;
    if (isRunning) {
      elapsedSec = userStartTime ? Math.max(0, Math.floor((Date.now() - userStartTime) / 1000)) : 0;
    } else {
      elapsedSec = (userStartTime && lastModTime) ? Math.max(0, Math.round((lastModTime - userStartTime) / 1000)) : 0;
    }

    const cached = tokenMetricsCache.get(active.id)?.data;

    return {
      id: active.id,
      title: active.annotations?.title || active.summary || '当前会话任务',
      isRunning,
      userStartTime,
      lastModTime,
      elapsedSec,
      stepCount: cached?.turnStepCount || active.stepCount || 0,
      outTokens: cached?.outTokens || 0,
      cacheTokens: cached?.cacheTokens || 0,
      inTokens: cached?.inTokens || 0,
      activeTool: cached?.activeTool || null
    };
  }

  function getOrCreateTaskPopover() {
    let popover = document.getElementById('agy-task-popover');
    if (!popover) {
      popover = document.createElement('div');
      popover.id = 'agy-task-popover';
      popover.style.cssText = [
        '-webkit-app-region: no-drag !important',
        'app-region: no-drag !important',
        'position: fixed',
        'z-index: 999999',
        'width: 350px',
        'background: #121316',
        'border: 1px solid #27272a',
        'border-radius: 10px',
        'box-shadow: 0 20px 48px rgba(0,0,0,0.65), 0 4px 16px rgba(0,0,0,0.3)',
        'padding: 12px',
        'font-size: 13px',
        'color: #e4e4e7',
        'backdrop-filter: blur(14px)',
        '-webkit-backdrop-filter: blur(14px)',
        'display: none',
        'opacity: 0',
        'transform: translateY(-6px)',
        'transition: opacity 0.18s ease, transform 0.18s ease',
        'pointer-events: auto',
        'font-family: ' + FONT_SANS
      ].join(';');

      popover.addEventListener('mouseenter', () => {
        if (hideTaskPopoverTimer) clearTimeout(hideTaskPopoverTimer);
      });
      popover.addEventListener('mouseleave', () => {
        if (isTaskPopoverPinned) return;
        const mode = config.taskTriggerMode || 'hover';
        if (mode === 'hover') scheduleHideTaskPopover();
      });
      popover.addEventListener('click', (e) => e.stopPropagation());
      document.body.appendChild(popover);
    }
    return popover;
  }

  function openTaskPopover(targetElement, pin = false) {
    closeQuotaPopover();
    if (hideTaskPopoverTimer) clearTimeout(hideTaskPopoverTimer);
    if (pin) isTaskPopoverPinned = true;

    const popover = getOrCreateTaskPopover();
    const rect = targetElement.getBoundingClientRect();
    popover.style.display = 'block';
    const left = Math.max(12, Math.min(window.innerWidth - 365, rect.left));
    const top = rect.bottom + 6;
    popover.style.top = top + 'px';
    popover.style.left = left + 'px';
    popover.style.opacity = '1';
    popover.style.transform = 'translateY(0)';
    targetElement.style.background = 'var(--secondary, rgba(255,255,255,0.12))';
  }

  function closeTaskPopover() {
    isTaskPopoverPinned = false;
    const popover = document.getElementById('agy-task-popover');
    const pill = document.getElementById('agy-task-timer-topbar');
    if (pill) {
      if (activeTaskState && activeTaskState.isRunning) {
        pill.style.background = 'rgba(34, 197, 94, 0.12)';
      } else {
        pill.style.background = 'var(--card, rgba(255,255,255,0.06))';
      }
    }
    if (!popover) return;

    popover.style.opacity = '0';
    popover.style.transform = 'translateY(-6px)';
    setTimeout(() => {
      if (!isTaskPopoverPinned && popover.style.opacity === '0') {
        popover.style.display = 'none';
      }
    }, 180);
  }

  function scheduleHideTaskPopover() {
    if (isTaskPopoverPinned) return;
    if (hideTaskPopoverTimer) clearTimeout(hideTaskPopoverTimer);
    hideTaskPopoverTimer = setTimeout(() => {
      if (!isTaskPopoverPinned) closeTaskPopover();
    }, 220);
  }

  function renderTaskPopoverContent(task) {
    if (window.__AGY_ACTIVE_INSTANCE_ID__ !== WIDGET_INSTANCE_ID) return;
    const popover = getOrCreateTaskPopover();
    if (!task) {
      popover.innerHTML = `<div style="font-family:${FONT_SANS};color:#a1a1aa;text-align:center;padding:16px;">暂无当前会话任务</div>`;
      return;
    }

    const isRunning = task.isRunning;
    const timeFormatted = formatTaskDuration(task.elapsedSec);
    const startTimeText = task.userStartTime ? new Date(task.userStartTime).toLocaleTimeString() : '--';

    const timerEl = popover.querySelector('#agy-task-popover-timer');
    if (timerEl) {
      // 增量精准更新，绝不重复销毁 DOM，彻底消除卡顿与闪烁
      timerEl.textContent = timeFormatted;
      timerEl.style.color = isRunning ? '#22c55e' : '#e4e4e7';

      const heroCard = popover.querySelector('#agy-task-hero-card');
      if (heroCard) {
        heroCard.style.borderColor = isRunning ? 'rgba(34,197,94,0.35)' : '#27272a';
        heroCard.style.boxShadow = isRunning ? '0 0 16px rgba(34,197,94,0.08)' : 'none';
      }

      const timerSubtitle = popover.querySelector('#agy-task-timer-subtitle');
      if (timerSubtitle) timerSubtitle.textContent = isRunning ? '当前任务已执行' : '上一轮任务总耗时';

      const startTimeEl = popover.querySelector('#agy-task-start-time');
      if (startTimeEl) startTimeEl.textContent = `开始: ${startTimeText}`;

      const titleEl = popover.querySelector('#agy-task-title-text');
      if (titleEl) {
        titleEl.textContent = task.title;
        titleEl.title = task.title;
      }

      const statusBadge = popover.querySelector('#agy-task-status-badge');
      if (statusBadge) {
        statusBadge.style.background = isRunning ? 'rgba(34,197,94,0.15)' : 'rgba(148,163,184,0.15)';
        statusBadge.style.color = isRunning ? '#22c55e' : '#a1a1aa';
        const badgeDot = statusBadge.querySelector('.agy-badge-dot');
        if (badgeDot) {
          badgeDot.style.animation = isRunning ? 'agy-pulse-dot 1.5s infinite' : 'none';
        }
        const badgeText = statusBadge.querySelector('.agy-badge-text');
        if (badgeText) badgeText.textContent = isRunning ? '执行中' : '已就绪';
      }

      const stepStatusEl = popover.querySelector('#agy-task-step-status');
      if (stepStatusEl) {
        stepStatusEl.textContent = task.activeTool ? '⚡ ' + task.activeTool : (isRunning ? '🧠 Agent Thinking / Planning' : '✓ 任务已完成');
      }

      const stepDescEl = popover.querySelector('#agy-task-step-desc');
      if (stepDescEl) {
        stepDescEl.textContent = task.activeTool ? '正在调用系统工具执行操作...' : (isRunning ? '模型正在推理与规划响应...' : '等待用户新的指令...');
      }

      const stepBadge = popover.querySelector('#agy-task-step-badge');
      if (stepBadge) stepBadge.textContent = isRunning ? '进行中' : '就绪';

      const stepsCountEl = popover.querySelector('#agy-task-metric-steps');
      if (stepsCountEl) stepsCountEl.textContent = task.stepCount;

      const outTokensEl = popover.querySelector('#agy-task-metric-out');
      if (outTokensEl) {
        outTokensEl.textContent = formatTokens(task.outTokens);
        outTokensEl.title = Number(task.outTokens).toLocaleString();
      }

      const cacheTokensEl = popover.querySelector('#agy-task-metric-cache');
      if (cacheTokensEl) {
        cacheTokensEl.textContent = formatTokens(task.cacheTokens);
        cacheTokensEl.title = Number(task.cacheTokens).toLocaleString();
      }

      const inTokensEl = popover.querySelector('#agy-task-metric-in');
      if (inTokensEl) inTokensEl.textContent = formatTokens(task.inTokens);

      return;
    }

    // 初次创建完整模板结构
    popover.innerHTML = `
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;border-bottom:1px solid #27272a;font-family:${FONT_SANS};">
        <div style="display:flex;align-items:center;gap:7px;font-weight:600;font-size:14px;color:#e4e4e7;">
          <span style="color:#3b82f6;font-size:15px;">⏱️</span>
          <span>任务计时器</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span id="agy-task-status-badge" style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:500;${isRunning ? 'background:rgba(34,197,94,0.15);color:#22c55e;' : 'background:rgba(148,163,184,0.15);color:#a1a1aa;'}">
            <span class="agy-badge-dot" style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;${isRunning ? 'animation:agy-pulse-dot 1.5s infinite;' : ''}"></span>
            <span class="agy-badge-text">${isRunning ? '执行中' : '已就绪'}</span>
          </span>
          <button id="agy-task-refresh-btn" title="立即刷新状态" style="-webkit-app-region:no-drag;cursor:pointer;background:transparent;border:1px solid #27272a;color:#a1a1aa;border-radius:6px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:12px;transition:all 0.15s;">
            🔄
          </button>
        </div>
      </div>

      <!-- Hero Timer Card -->
      <div id="agy-task-hero-card" style="background:#1a1b20;border:1px solid ${isRunning ? 'rgba(34,197,94,0.35)' : '#27272a'};border-radius:8px;padding:12px;text-align:center;margin-top:10px;${isRunning ? 'box-shadow:0 0 16px rgba(34,197,94,0.08);' : ''}">
        <div id="agy-task-timer-subtitle" style="font-size:11px;font-weight:500;color:#a1a1aa;letter-spacing:0.5px;margin-bottom:2px;font-family:${FONT_SANS};">
          ${isRunning ? '当前任务已执行' : '上一轮任务总耗时'}
        </div>
        <div id="agy-task-popover-timer" style="font-family:${FONT_MONO};font-size:38px;font-weight:700;letter-spacing:-1px;color:${isRunning ? '#22c55e' : '#e4e4e7'};line-height:1.15;margin:4px 0;">
          ${timeFormatted}
        </div>
        <div id="agy-task-start-time" style="font-size:10px;color:#a1a1aa;margin-top:2px;font-family:${FONT_MONO};">
          开始: ${startTimeText}
        </div>
        <div style="margin-top:10px;background:#27272a;border-radius:6px;padding:6px 8px;text-align:left;display:flex;align-items:flex-start;gap:6px;font-size:11px;">
          <span style="background:rgba(59,130,246,0.2);color:#60a5fa;font-size:9px;padding:1px 4px;border-radius:3px;font-weight:600;flex-shrink:0;">指令</span>
          <span id="agy-task-title-text" style="color:#e4e4e7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.35;font-family:${FONT_SANS};" title="${task.title}">
            ${task.title}
          </span>
        </div>
      </div>

      <!-- Active Step Card -->
      <div style="background:#1a1b20;border:1px solid ${isRunning ? 'rgba(59,130,246,0.4)' : '#27272a'};border-radius:8px;padding:10px 12px;margin-top:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-weight:600;font-size:12px;color:#e4e4e7;display:flex;align-items:center;gap:6px;font-family:${FONT_SANS};">
            <span style="width:7px;height:7px;border-radius:50%;background:${isRunning ? '#22c55e' : '#94a3b8'};display:inline-block;${isRunning ? 'animation:agy-pulse-dot 1.2s infinite;' : ''}"></span>
            当前步骤状态
          </div>
          <span id="agy-task-step-badge" style="font-family:${FONT_MONO};font-size:11px;font-weight:600;color:#3b82f6;background:rgba(59,130,246,0.1);padding:1px 6px;border-radius:4px;">
            ${isRunning ? '进行中' : '就绪'}
          </span>
        </div>
        <div id="agy-task-step-status" style="font-family:${FONT_MONO};font-size:12px;font-weight:600;color:#38bdf8;display:flex;align-items:center;gap:5px;">
          <span>${task.activeTool ? '⚡ ' + task.activeTool : (isRunning ? '🧠 Agent Thinking / Planning' : '✓ 任务已完成')}</span>
        </div>
        <div id="agy-task-step-desc" style="font-size:11px;color:#a1a1aa;margin-top:2px;font-family:${FONT_SANS};">
          ${task.activeTool ? '正在调用系统工具执行操作...' : (isRunning ? '模型正在推理与规划响应...' : '等待用户新的指令...')}
        </div>
      </div>

      <!-- Metrics Grid (3 Columns like Image 2) -->
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-top:8px;">
        <div style="background:#1a1b20;border:1px solid #27272a;border-radius:7px;padding:8px 6px;text-align:center;">
          <div id="agy-task-metric-steps" style="font-family:${FONT_MONO};font-size:15px;font-weight:700;color:#e4e4e7;">
            ${task.stepCount}
          </div>
          <div style="font-size:11px;color:#a1a1aa;margin-top:2px;font-family:${FONT_SANS};">步骤数</div>
        </div>

        <div style="background:#1a1b20;border:1px solid #27272a;border-radius:7px;padding:8px 6px;text-align:center;">
          <div id="agy-task-metric-out" style="font-family:${FONT_MONO};font-size:15px;font-weight:700;color:#e4e4e7;" title="${Number(task.outTokens).toLocaleString()}">
            ${formatTokens(task.outTokens)}
          </div>
          <div style="font-size:11px;color:#a1a1aa;margin-top:2px;font-family:${FONT_SANS};">输出 Tokens</div>
        </div>

        <div style="background:#1a1b20;border:1px solid #27272a;border-radius:7px;padding:8px 6px;text-align:center;">
          <div id="agy-task-metric-cache" style="font-family:${FONT_MONO};font-size:15px;font-weight:700;color:#22c55e;" title="${Number(task.cacheTokens).toLocaleString()}">
            ${formatTokens(task.cacheTokens)}
          </div>
          <div style="font-size:11px;color:#a1a1aa;margin-top:2px;font-family:${FONT_SANS};">缓存命中</div>
        </div>
      </div>

      <!-- Footer Sub-bar -->
      <div style="font-size:10px;color:#a1a1aa;display:flex;justify-content:space-between;margin-top:8px;padding-top:6px;border-top:1px solid #27272a;font-family:${FONT_SANS};">
        <span>输入: <strong id="agy-task-metric-in" style="font-family:${FONT_MONO};color:#e4e4e7;">${formatTokens(task.inTokens)}</strong> Tokens</span>
        <span style="color:#22c55e;">● 当前窗口毫秒级同步</span>
      </div>
    `;

    const refBtn = popover.querySelector('#agy-task-refresh-btn');
    if (refBtn) {
      refBtn.onclick = async (e) => {
        e.stopPropagation();
        refBtn.textContent = '⏳';
        await refreshTaskOnly(true);
      };
    }
  }

  function updateTaskTimerPill(task) {
    if (window.__AGY_ACTIVE_INSTANCE_ID__ !== WIDGET_INSTANCE_ID) return;
    const topBar = document.querySelector('.bg-sidebar') || document.querySelector('.shrink-0');
    if (!topBar) return;

    let pill = document.getElementById('agy-task-timer-topbar');
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'agy-task-timer-topbar';
      pill.type = 'button';
      pill.style.cssText = [
        '-webkit-app-region: no-drag !important',
        'app-region: no-drag !important',
        'display: inline-flex',
        'align-items: center',
        'gap: 6px',
        'padding: 3px 10px',
        'border-radius: 9999px',
        'background: var(--card, rgba(255,255,255,0.06))',
        'border: 1px solid var(--border, rgba(255,255,255,0.12))',
        'font-size: 12px',
        'color: var(--foreground, #e5e7eb)',
        'cursor: pointer',
        'margin-left: 6px',
        'user-select: none',
        'outline: none',
        'transition: all 0.15s ease',
        'position: relative',
        'z-index: 50'
      ].join(';');

      pill.innerHTML = `
        <span id="agy-task-pill-dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#94a3b8;flex-shrink:0;"></span>
        <span id="agy-task-pill-text" style="font-family:${FONT_MONO};font-size:11px;opacity:0.85;color:#e4e4e7;">就绪</span>
        <span id="agy-task-pill-badge" style="display:none;font-size:10px;color:#60a5fa;background:rgba(59,130,246,0.18);padding:1px 5px;border-radius:3px;max-width:85px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:${FONT_MONO};"></span>
      `;

      pill.addEventListener('mouseenter', () => {
        const mode = config.taskTriggerMode || 'hover';
        if (mode === 'hover') openTaskPopover(pill, false);
      });
      pill.addEventListener('mouseleave', () => {
        const mode = config.taskTriggerMode || 'hover';
        if (mode === 'hover') scheduleHideTaskPopover();
      });
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const popover = document.getElementById('agy-task-popover');
        const isCurrentlyVisible = popover && popover.style.display === 'block' && popover.style.opacity === '1';
        if (isCurrentlyVisible && isTaskPopoverPinned) {
          closeTaskPopover();
        } else {
          openTaskPopover(pill, true);
          refreshTaskOnly(true);
        }
      });

      const quotaPill = document.getElementById('agy-model-quota-topbar');
      if (quotaPill && quotaPill.nextSibling) {
        topBar.insertBefore(pill, quotaPill.nextSibling);
      } else {
        topBar.appendChild(pill);
      }
    }

    const dotEl = pill.querySelector('#agy-task-pill-dot');
    const textEl = pill.querySelector('#agy-task-pill-text');
    const badgeEl = pill.querySelector('#agy-task-pill-badge');
    if (!dotEl || !textEl) return;

    if (!task) {
      pill.style.background = 'var(--card, rgba(255,255,255,0.06))';
      pill.style.borderColor = 'var(--border, rgba(255,255,255,0.12))';
      dotEl.style.background = '#94a3b8';
      dotEl.style.boxShadow = 'none';
      dotEl.style.animation = 'none';
      textEl.style.color = '#e4e4e7';
      textEl.style.fontSize = '11px';
      textEl.style.fontWeight = 'normal';
      textEl.textContent = '就绪';
      if (badgeEl) badgeEl.style.display = 'none';
      pill.title = '当前会话任务就绪\n单击展开详情与 Token 统计';
      return;
    }

    const isRunning = task.isRunning;
    const timeFormatted = formatTaskDuration(task.elapsedSec);

    if (isRunning) {
      pill.style.background = 'rgba(34, 197, 94, 0.12)';
      pill.style.borderColor = 'rgba(34, 197, 94, 0.35)';

      dotEl.style.background = '#22c55e';
      dotEl.style.boxShadow = '0 0 6px rgba(34,197,94,0.8)';
      if (!dotEl.style.animation || dotEl.style.animation === 'none') {
        dotEl.style.animation = 'agy-pulse-dot 1.5s infinite';
      }

      textEl.style.color = '#22c55e';
      textEl.style.fontSize = '12px';
      textEl.style.fontWeight = '600';
      textEl.textContent = `执行中 ${timeFormatted}`;

      if (badgeEl) {
        if (task.activeTool) {
          badgeEl.textContent = `⚡${task.activeTool}`;
          badgeEl.style.display = 'inline-block';
        } else {
          badgeEl.style.display = 'none';
        }
      }

      pill.title = `当前会话任务执行中: 已耗时 ${timeFormatted}\n单击展开详情与 Token 统计`;
    } else {
      pill.style.background = 'var(--card, rgba(255,255,255,0.06))';
      pill.style.borderColor = 'var(--border, rgba(255,255,255,0.12))';

      dotEl.style.background = '#94a3b8';
      dotEl.style.boxShadow = 'none';
      dotEl.style.animation = 'none';

      textEl.style.color = '#e4e4e7';
      textEl.style.fontSize = '11px';
      textEl.style.fontWeight = 'normal';
      textEl.textContent = task.elapsedSec ? `已完成 ${timeFormatted}` : '就绪';

      if (badgeEl) badgeEl.style.display = 'none';
      pill.title = `当前会话任务就绪 (上次耗时: ${timeFormatted})\n单击展开详情与 Token 统计`;
    }
  }


  // =========================================================================
  // 3. 全局秒级本地平滑秒表与状态刷新
  // =========================================================================
  function tickTimer() {
    if (window.__AGY_ACTIVE_INSTANCE_ID__ !== WIDGET_INSTANCE_ID) return;
    if (activeTaskState && activeTaskState.isRunning && activeTaskState.userStartTime) {
      const elapsed = Math.max(0, Math.floor((Date.now() - activeTaskState.userStartTime) / 1000));
      activeTaskState.elapsedSec = elapsed;

      updateTaskTimerPill(activeTaskState);

      const popoverTimerEl = document.getElementById('agy-task-popover-timer');
      if (popoverTimerEl) {
        popoverTimerEl.textContent = formatTaskDuration(elapsed);
      }
    }
  }

  async function refreshTaskOnly(force = false) {
    if (window.__AGY_ACTIVE_INSTANCE_ID__ !== WIDGET_INSTANCE_ID) return;
    const raw = await fetchTaskStatus();
    if (!raw || window.__AGY_ACTIVE_INSTANCE_ID__ !== WIDGET_INSTANCE_ID) return;

    // 1. 0ms 同步极速通道：提取当前会话并毫秒级更新顶栏胶囊与标题
    activeTaskState = resolveActiveTaskFast(raw);
    updateTaskTimerPill(activeTaskState);
    renderTaskPopoverContent(activeTaskState);

    // 2. 异步慢通道：在后台非阻塞解析本轮 Token 与工具调用
    if (activeTaskState?.id) {
      const activeId = activeTaskState.id;
      const lastMod = activeTaskState.lastModTime;
      fetchTurnTokenMetrics(activeId, lastMod).then(tokenMetrics => {
        if (tokenMetrics && activeTaskState && activeTaskState.id === activeId) {
          activeTaskState.stepCount = tokenMetrics.turnStepCount;
          activeTaskState.outTokens = tokenMetrics.outTokens;
          activeTaskState.cacheTokens = tokenMetrics.cacheTokens;
          activeTaskState.inTokens = tokenMetrics.inTokens;
          activeTaskState.activeTool = tokenMetrics.activeTool;
          updateTaskTimerPill(activeTaskState);
          renderTaskPopoverContent(activeTaskState);
        }
      });
    }
  }

  async function refreshQuotaOnly(force = false) {
    const data = await fetchQuota(force);
    const parsed = parseQuota(data);
    updateQuotaTopPill(parsed);
    renderQuotaPopoverContent(parsed);
  }

  async function refreshAll(force = false) {
    await Promise.all([
      refreshQuotaOnly(force),
      refreshTaskOnly(force)
    ]);
  }

  async function renderAll() {
    if (!quotaData) {
      refreshQuotaOnly(false);
    } else {
      const parsedQuota = parseQuota(quotaData);
      updateQuotaTopPill(parsedQuota);
      renderQuotaPopoverContent(parsedQuota);
    }

    if (!activeTaskState && currentTaskData) {
      activeTaskState = resolveActiveTaskFast(currentTaskData);
    }
    updateTaskTimerPill(activeTaskState);
    renderTaskPopoverContent(activeTaskState);
  }

  function setupPollingTimer() {
    if (pollIntervalTimer) {
      clearInterval(pollIntervalTimer);
      pollIntervalTimer = null;
    }
    if (window.__AGY_TASK_POLL_TIMER__) {
      clearInterval(window.__AGY_TASK_POLL_TIMER__);
      window.__AGY_TASK_POLL_TIMER__ = null;
    }
    // 快速任务轮询（1 秒一次极速同步当前窗口会话与任务变动）
    pollIntervalTimer = setInterval(() => {
      refreshTaskOnly(false);
      const now = Date.now();
      if (!quotaData || (config.refreshInterval > 0 && now - lastQuotaFetchTime >= config.refreshInterval * 1000)) {
        refreshQuotaOnly(false);
      }
    }, 1000);
    window.__AGY_TASK_POLL_TIMER__ = pollIntervalTimer;
  }

  // 点击外部收起
  function onDocumentClick(e) {
    const quotaPill = document.getElementById('agy-model-quota-topbar');
    const quotaPopover = document.getElementById('agy-quota-popover');
    if (!(quotaPill && quotaPill.contains(e.target)) && !(quotaPopover && quotaPopover.contains(e.target))) {
      closeQuotaPopover();
    }

    const taskPill = document.getElementById('agy-task-timer-topbar');
    const taskPopover = document.getElementById('agy-task-popover');
    if (!(taskPill && taskPill.contains(e.target)) && !(taskPopover && taskPopover.contains(e.target))) {
      closeTaskPopover();
    }
  }
  document.addEventListener('click', onDocumentClick, true);

  function ensureNoChatBadge() {
    const chatBadge = document.getElementById('agy-chat-quota-badge');
    if (chatBadge) chatBadge.remove();
  }

  let debounceAttachTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceAttachTimer) clearTimeout(debounceAttachTimer);
    debounceAttachTimer = setTimeout(() => {
      ensureNoChatBadge();
      const topPill = document.getElementById('agy-model-quota-topbar');
      const taskPill = document.getElementById('agy-task-timer-topbar');
      if (!topPill || !taskPill) {
        renderAll();
      }
    }, 150);
  });

  // 安全启动
  function startObserverAndMount() {
    const root = document.body || document.documentElement;
    if (root) {
      try {
        observer.observe(root, { childList: true, subtree: true });
      } catch (_) {}
    }
    refreshAll();
    setupPollingTimer();

    // 启动 1 秒本地平滑秒表，并绑定全局单例定时器
    if (window.__AGY_TASK_TICK_TIMER__) {
      clearInterval(window.__AGY_TASK_TICK_TIMER__);
    }
    window.__AGY_TASK_TICK_TIMER__ = setInterval(tickTimer, 1000);

    let retryCount = 0;
    const retryTimer = setInterval(() => {
      retryCount++;
      const pill = document.getElementById('agy-model-quota-topbar');
      const taskPill = document.getElementById('agy-task-timer-topbar');
      if (!pill || !taskPill) {
        renderAll();
      }
      if ((pill && taskPill) || retryCount >= 10) {
        clearInterval(retryTimer);
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserverAndMount);
  } else {
    startObserverAndMount();
  }

  const onWindowActivate = () => {
    tickTimer();
    refreshTaskOnly(true);
    refreshQuotaOnly(false);
  };
  window.addEventListener('focus', onWindowActivate);

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      onWindowActivate();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // 毫秒级捕获会话标签与侧边栏点击，彻底消除切换会话的等待延迟
  const onPointerUp = (e) => {
    const target = e.target;
    if (target && target.closest && (target.closest('.tabs-container') || target.closest('.monaco-list') || target.closest('[role="tab"]') || target.closest('.activitybar'))) {
      setTimeout(() => refreshTaskOnly(false), 50);
    }
  };
  document.addEventListener('pointerup', onPointerUp, true);

  window.__AGY_QUOTA_CLEANUP__ = () => {
    observer.disconnect();
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (pollIntervalTimer) clearInterval(pollIntervalTimer);
    if (window.__AGY_TASK_POLL_TIMER__) {
      clearInterval(window.__AGY_TASK_POLL_TIMER__);
      window.__AGY_TASK_POLL_TIMER__ = null;
    }
    if (window.__AGY_TASK_TICK_TIMER__) {
      clearInterval(window.__AGY_TASK_TICK_TIMER__);
      window.__AGY_TASK_TICK_TIMER__ = null;
    }
    window.removeEventListener('focus', onWindowActivate);
    removeEl('agy-model-quota-topbar');
    removeEl('agy-quota-popover');
    removeEl('agy-task-timer-topbar');
    removeEl('agy-task-popover');
  };
})();
