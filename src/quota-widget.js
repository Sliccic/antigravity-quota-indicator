/**
 * Antigravity Real-Time Model Quota Indicator Widget
 * 实时模型余量显示组件 - 常驻顶部标题栏（支持设置选项、时间风格定制、触发模式切换与按需平滑毫秒倒计时）
 */
(function initModelQuotaWidget() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // 清理可能存在的旧实例与旧 DOM 节点，确保更新后立即无缝生效
  const oldChatBadge = document.getElementById('agy-chat-quota-badge');
  if (oldChatBadge) oldChatBadge.remove();

  const oldPill = document.getElementById('agy-model-quota-topbar');
  if (oldPill) oldPill.remove();

  const oldPopover = document.getElementById('agy-quota-popover');
  if (oldPopover) oldPopover.remove();

  if (window.__AGY_MODEL_QUOTA_WIDGET_INITIALIZED__) {
    if (window.__AGY_QUOTA_CLEANUP__) {
      window.__AGY_QUOTA_CLEANUP__();
    }
  }
  window.__AGY_MODEL_QUOTA_WIDGET_INITIALIZED__ = true;

  // 统一现代无衬线原生字体栈与等宽字体栈
  const FONT_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  const FONT_NUM = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

  // 用户持久化配置
  const CONFIG_STORAGE_KEY = 'agy_quota_widget_config_v2';
  const DEFAULT_CONFIG = {
    triggerMode: 'hover', // 'click' (单击展开) | 'hover' (悬停展开)
    refreshInterval: 60,  // 秒数: 30, 60, 120, 300, 0 (手动)
    timeStyle: 'zh'       // 'zh' (？小时？分钟、？天？小时) | 'en' (?h ?m, ?d ?h)
  };

  let config = loadConfig();

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (raw) {
        return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
      }
    } catch (_) {}
    return Object.assign({}, DEFAULT_CONFIG);
  }

  function saveConfig(newCfg) {
    config = Object.assign({}, config, newCfg);
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch (_) {}
    // 重启后台定时轮询
    setupPollingTimer();
    // 重新渲染
    renderAll();
  }

  let quotaData = null;
  let isFetching = false;
  let lastFetchTime = 0;
  let pollIntervalTimer = null;
  let hidePopoverTimer = null;
  let isPopoverPinned = false;
  let currentCardView = 'quota'; // 'quota' | 'settings'

  // 按需平滑倒计时器引用（仅在 Popover 展开可见时启动，关闭立即完全休眠）
  let popoverTickTimer = null;

  async function fetchQuota(force = false) {
    if (isFetching && !force) return quotaData;
    const now = Date.now();
    if (!force && quotaData && now - lastFetchTime < 4000) {
      return quotaData;
    }

    const csrfToken = window.__APP_CONFIG__?.csrfToken;
    if (!csrfToken) {
      // 客户端初次冷启动时若 __APP_CONFIG__ 尚未挂载，800ms 后自动重试
      if (!window.__AGY_CSRF_RETRY_TIMER__) {
        window.__AGY_CSRF_RETRY_TIMER__ = setTimeout(() => {
          window.__AGY_CSRF_RETRY_TIMER__ = null;
          if (window.__APP_CONFIG__?.csrfToken && !quotaData) {
            refreshAll(true);
          }
        }, 800);
      }
      return null;
    }

    try {
      isFetching = true;
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
      lastFetchTime = Date.now();
      return json;
    } catch (err) {
      console.warn('[ModelQuotaWidget] Fetch quota failed:', err);
      return null;
    } finally {
      isFetching = false;
    }
  }

  function parseQuota(data) {
    if (!data) return null;
    const groups = data?.response?.groups || data?.groups || (Array.isArray(data) ? data : null);
    if (!groups || !Array.isArray(groups)) return null;

    const gemini = groups.find(g => g.displayName?.includes('Gemini')) || groups[0];
    const g5h = gemini?.buckets?.find(b => b.window === '5h');
    const gW = gemini?.buckets?.find(b => b.window === 'weekly');

    const tp = groups.find(g => g.displayName?.includes('Claude') || g.displayName?.includes('GPT') || g.displayName?.includes('Third') || g.displayName?.includes('3p'));
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

  // 格式化 5 小时限额重置倒计时：？小时？分钟 或 ？h ？m
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

  // 格式化 7 天周限额重置倒计时：？天？小时 或 ？d ？h
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

  // 格式化接口同步距离当前时间
  function formatSyncAge(timeMs) {
    if (!timeMs) return '刚刚';
    const sec = Math.max(0, Math.floor((Date.now() - timeMs) / 1000));
    if (sec < 5) return '刚刚已同步';
    if (sec < 60) return `${sec}秒前已同步`;
    const min = Math.floor(sec / 60);
    return `${min}分钟前已同步`;
  }

  function getStatusColor(pct) {
    if (pct > 50) return '#10b981'; // 绿
    if (pct > 20) return '#f59e0b'; // 黄
    return '#ef4444'; // 红
  }

  function getOrCreatePopover() {
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
        'background: var(--card, #1c1d21)',
        'border: 1px solid var(--border, rgba(255,255,255,0.15))',
        'border-radius: 12px',
        'box-shadow: 0 16px 36px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.25)',
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
        if (hidePopoverTimer) clearTimeout(hidePopoverTimer);
      });
      popover.addEventListener('mouseleave', () => {
        if (currentCardView === 'settings' || isPopoverPinned) return;
        if (config.triggerMode === 'hover') {
          scheduleHidePopover();
        }
      });
      popover.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      document.body.appendChild(popover);
    }
    return popover;
  }

  // 按需平滑倒计时控制函数
  function stopPopoverTickTimer() {
    if (popoverTickTimer) {
      clearInterval(popoverTickTimer);
      popoverTickTimer = null;
    }
  }

  function startPopoverTickTimer() {
    stopPopoverTickTimer();
    popoverTickTimer = setInterval(() => {
      const popover = document.getElementById('agy-quota-popover');
      if (!popover || popover.style.display === 'none' || currentCardView !== 'quota') {
        stopPopoverTickTimer();
        return;
      }
      tickPopoverElements();
    }, 1000);
  }

  function tickPopoverElements() {
    const parsed = parseQuota(quotaData);
    if (!parsed) return;
    const style = config.timeStyle;

    const elG5h = document.getElementById('agy-gemini-5h-text');
    if (elG5h && parsed.gemini?.reset5h) {
      elG5h.textContent = format5hReset(parsed.gemini.reset5h, style);
    }

    const elGW = document.getElementById('agy-gemini-w-text');
    if (elGW && parsed.gemini?.resetW) {
      elGW.textContent = formatWeeklyReset(parsed.gemini.resetW, style);
    }

    if (parsed.thirdParty) {
      const elTp5h = document.getElementById('agy-tp-5h-text');
      if (elTp5h && parsed.thirdParty.reset5h) {
        elTp5h.textContent = format5hReset(parsed.thirdParty.reset5h, style);
      }

      const elTpW = document.getElementById('agy-tp-w-text');
      if (elTpW && parsed.thirdParty.resetW) {
        elTpW.textContent = formatWeeklyReset(parsed.thirdParty.resetW, style);
      }
    }

    const elSyncAge = document.getElementById('agy-sync-age-text');
    if (elSyncAge) {
      elSyncAge.textContent = formatSyncAge(lastFetchTime);
    }
  }

  function openPopover(targetElement, pin = false) {
    if (hidePopoverTimer) clearTimeout(hidePopoverTimer);
    if (pin) isPopoverPinned = true;

    const popover = getOrCreatePopover();

    // 打开瞬间立即根据当前最新毫秒数刷新视图，绝不展示过时缓存
    if (currentCardView === 'quota') {
      const parsed = parseQuota(quotaData);
      if (parsed) renderQuotaView(popover, parsed);
    }

    const rect = targetElement.getBoundingClientRect();

    popover.style.display = 'block';
    const left = Math.max(12, Math.min(window.innerWidth - 345, rect.left));
    const top = rect.bottom + 6;
    popover.style.top = top + 'px';
    popover.style.left = left + 'px';
    popover.style.opacity = '1';
    popover.style.transform = 'translateY(0)';

    targetElement.style.background = 'var(--secondary, rgba(255,255,255,0.12))';

    // 唤醒按需秒级平滑倒计时
    startPopoverTickTimer();
  }

  function closePopover() {
    isPopoverPinned = false;
    currentCardView = 'quota'; // 收起后重置为配额视图
    stopPopoverTickTimer(); // 立即休眠，彻底释放 CPU 算力

    const popover = document.getElementById('agy-quota-popover');
    const pill = document.getElementById('agy-model-quota-topbar');
    if (pill) {
      pill.style.background = 'var(--card, rgba(255,255,255,0.06))';
    }
    if (!popover) return;

    popover.style.opacity = '0';
    popover.style.transform = 'translateY(-6px)';
    setTimeout(() => {
      if (!isPopoverPinned && popover.style.opacity === '0') {
        popover.style.display = 'none';
      }
    }, 180);
  }

  function scheduleHidePopover() {
    if (isPopoverPinned || currentCardView === 'settings') return;
    if (hidePopoverTimer) clearTimeout(hidePopoverTimer);
    hidePopoverTimer = setTimeout(() => {
      if (!isPopoverPinned && currentCardView !== 'settings') closePopover();
    }, 220);
  }

  function renderPopoverContent(parsed) {
    const popover = getOrCreatePopover();
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

  // 配额主视图
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

        <!-- 5h limit -->
        <div style="margin-bottom:7px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;opacity:0.85;">
            <span>${style === 'zh' ? '5小时限额' : '5-Hour Limit'}</span>
            <span>
              <strong style="color:${getStatusColor(g.p5h)};font-family:${FONT_SANS};font-variant-numeric:tabular-nums;font-weight:700;">
                ${g.p5h}<span style="font-size:10px;font-weight:500;opacity:0.8;margin-left:0.5px;">%</span>
              </strong> · <span id="agy-gemini-5h-text" style="font-family:${FONT_NUM};font-variant-numeric:tabular-nums;">${g5hText}</span>
            </span>
          </div>
          <div style="height:5px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
            <div style="width:${g.p5h}%;height:100%;background:${getStatusColor(g.p5h)};border-radius:3px;transition:width 0.3s ease;"></div>
          </div>
        </div>

        <!-- Weekly limit -->
        <div>
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;opacity:0.85;">
            <span>${style === 'zh' ? '七天限额' : 'Weekly Limit'}</span>
            <span>
              <strong style="color:${getStatusColor(g.pW)};font-family:${FONT_SANS};font-variant-numeric:tabular-nums;font-weight:700;">
                ${g.pW}<span style="font-size:10px;font-weight:500;opacity:0.8;margin-left:0.5px;">%</span>
              </strong> · <span id="agy-gemini-w-text" style="font-family:${FONT_NUM};font-variant-numeric:tabular-nums;">${gWText}</span>
            </span>
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
        <!-- Claude & GPT Section -->
        <div style="padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);margin-bottom:8px;font-family:${FONT_SANS};">
          <div style="font-weight:500;color:var(--foreground,#fff);margin-bottom:6px;display:flex;justify-content:space-between;">
            <span>${tp.name}</span>
            <span style="font-size:11px;opacity:0.6;">第三方模型</span>
          </div>

          <div style="margin-bottom:7px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;opacity:0.85;">
              <span>${style === 'zh' ? '5小时限额' : '5-Hour Limit'}</span>
              <span>
                <strong style="color:${getStatusColor(tp.p5h)};font-family:${FONT_SANS};font-variant-numeric:tabular-nums;font-weight:700;">
                  ${tp.p5h}<span style="font-size:10px;font-weight:500;opacity:0.8;margin-left:0.5px;">%</span>
                </strong> · <span id="agy-tp-5h-text" style="font-family:${FONT_NUM};font-variant-numeric:tabular-nums;">${tp5hText}</span>
              </span>
            </div>
            <div style="height:5px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
              <div style="width:${tp.p5h}%;height:100%;background:${getStatusColor(tp.p5h)};border-radius:3px;transition:width 0.3s ease;"></div>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;opacity:0.85;">
              <span>${style === 'zh' ? '七天限额' : 'Weekly Limit'}</span>
              <span>
                <strong style="color:${getStatusColor(tp.pW)};font-family:${FONT_SANS};font-variant-numeric:tabular-nums;font-weight:700;">
                  ${tp.pW}<span style="font-size:10px;font-weight:500;opacity:0.8;margin-left:0.5px;">%</span>
                </strong> · <span id="agy-tp-w-text" style="font-family:${FONT_NUM};font-variant-numeric:tabular-nums;">${tpWText}</span>
              </span>
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
      <div style="margin-top:10px;padding-top:6px;font-size:10px;opacity:0.65;display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,0.06);font-family:${FONT_SANS};">
        <span>${triggerLabel}</span>
        <span style="display:inline-flex;align-items:center;gap:4px;">
          <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#10b981;box-shadow:0 0 4px #10b98188;"></span>
          <span id="agy-sync-age-text">${formatSyncAge(lastFetchTime)}</span>
          <span style="opacity:0.4;">·</span>
          <span>${intervalLabel}</span>
        </span>
      </div>
    `;

    popover.innerHTML = html;

    const refBtn = popover.querySelector('#agy-quota-refresh-action');
    if (refBtn) {
      refBtn.onclick = async (e) => {
        e.stopPropagation();
        refBtn.textContent = '⏳';
        await refreshAll(true);
      };
    }

    const setBtn = popover.querySelector('#agy-quota-settings-action');
    if (setBtn) {
      setBtn.onclick = (e) => {
        e.stopPropagation();
        currentCardView = 'settings';
        stopPopoverTickTimer();
        renderSettingsView(popover);
      };
    }
  }

  // 设置参数视图
  function renderSettingsView(popover) {
    const isClick = config.triggerMode === 'click';
    const isHover = config.triggerMode === 'hover';
    const isZh = config.timeStyle === 'zh';
    const isEn = config.timeStyle === 'en';

    const activeBtnStyle = 'background:var(--primary, #3b82f6);color:#fff;border:1px solid transparent;font-weight:600;box-shadow: 0 1px 3px rgba(0,0,0,0.3);';
    const normalBtnStyle = 'background:rgba(255,255,255,0.06);color:var(--foreground,#e5e7eb);border:1px solid rgba(255,255,255,0.1);font-weight:normal;';

    const html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);font-family:${FONT_SANS};">
        <button id="agy-settings-back" style="-webkit-app-region:no-drag;cursor:pointer;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:var(--foreground,#fff);font-size:11px;padding:3px 8px;border-radius:6px;display:flex;align-items:center;gap:4px;font-family:${FONT_SANS};">
          ← 返回
        </button>
        <span style="font-weight:600;font-size:13px;">⚙️ 插件参数设置</span>
        <span style="width:36px;"></span>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;font-size:12px;font-family:${FONT_SANS};">
        <!-- 1. 触发模式 -->
        <div>
          <div style="font-weight:500;margin-bottom:6px;opacity:0.9;display:flex;justify-content:space-between;">
            <span>面板展开触发方式</span>
            <span style="font-size:10px;opacity:0.5;">${isClick ? '当前: 单击' : '当前: 悬停'}</span>
          </div>
          <div style="display:flex;gap:6px;">
            <button id="opt-trigger-click" style="flex:1;padding:6px 8px;border-radius:6px;font-size:11px;cursor:pointer;-webkit-app-region:no-drag;transition:all 0.15s;font-family:${FONT_SANS};${isClick ? activeBtnStyle : normalBtnStyle}">
              👆 单击展开
            </button>
            <button id="opt-trigger-hover" style="flex:1;padding:6px 8px;border-radius:6px;font-size:11px;cursor:pointer;-webkit-app-region:no-drag;transition:all 0.15s;font-family:${FONT_SANS};${isHover ? activeBtnStyle : normalBtnStyle}">
              🖱️ 悬停展开
            </button>
          </div>
        </div>

        <!-- 2. 刷新频率 -->
        <div>
          <div style="font-weight:500;margin-bottom:6px;opacity:0.9;">自动刷新时间间隔</div>
          <select id="opt-refresh-select" style="width:100%;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.08);color:var(--foreground,#e5e7eb);border:1px solid rgba(255,255,255,0.15);font-size:11px;cursor:pointer;-webkit-app-region:no-drag;outline:none;font-family:${FONT_SANS};">
            <option value="30" ${config.refreshInterval === 30 ? 'selected' : ''}>30 秒</option>
            <option value="60" ${config.refreshInterval === 60 ? 'selected' : ''}>60 秒 (默认推荐)</option>
            <option value="120" ${config.refreshInterval === 120 ? 'selected' : ''}>2 分钟</option>
            <option value="300" ${config.refreshInterval === 300 ? 'selected' : ''}>5 分钟</option>
            <option value="0" ${config.refreshInterval === 0 ? 'selected' : ''}>仅手动刷新 (关闭自动)</option>
          </select>
        </div>

        <!-- 3. 时间风格 -->
        <div>
          <div style="font-weight:500;margin-bottom:6px;opacity:0.9;display:flex;justify-content:space-between;">
            <span>限额显示风格</span>
            <span style="font-size:10px;opacity:0.5;">${isZh ? '中文风格' : '英文风格'}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <button id="opt-style-zh" style="text-align:left;padding:7px 10px;border-radius:6px;font-size:11px;cursor:pointer;-webkit-app-region:no-drag;transition:all 0.15s;font-family:${FONT_SANS};${isZh ? activeBtnStyle : normalBtnStyle}">
              中文格式: <strong>4小时28分钟</strong> · <strong>5天22小时</strong>
            </button>
            <button id="opt-style-en" style="text-align:left;padding:7px 10px;border-radius:6px;font-size:11px;cursor:pointer;-webkit-app-region:no-drag;transition:all 0.15s;font-family:${FONT_SANS};${isEn ? activeBtnStyle : normalBtnStyle}">
              英文格式: <strong>4h 28m</strong> · <strong>5d 22h</strong>
            </button>
          </div>
        </div>
      </div>

      <div style="margin-top:14px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:flex-end;">
        <button id="agy-settings-done" style="-webkit-app-region:no-drag;cursor:pointer;background:var(--primary, #3b82f6);color:#fff;font-size:11px;padding:5px 14px;border-radius:6px;border:none;font-weight:500;font-family:${FONT_SANS};">
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
      startPopoverTickTimer();
    };

    if (backBtn) backBtn.onclick = goBack;
    if (doneBtn) doneBtn.onclick = goBack;

    // 绑定选项事件
    const btnClick = popover.querySelector('#opt-trigger-click');
    const btnHover = popover.querySelector('#opt-trigger-hover');
    if (btnClick) {
      btnClick.onclick = (e) => {
        e.stopPropagation();
        saveConfig({ triggerMode: 'click' });
        renderSettingsView(popover);
      };
    }
    if (btnHover) {
      btnHover.onclick = (e) => {
        e.stopPropagation();
        saveConfig({ triggerMode: 'hover' });
        renderSettingsView(popover);
      };
    }

    const selectRefresh = popover.querySelector('#opt-refresh-select');
    if (selectRefresh) {
      selectRefresh.onchange = (e) => {
        e.stopPropagation();
        const val = parseInt(selectRefresh.value, 10);
        saveConfig({ refreshInterval: isNaN(val) ? 60 : val });
      };
    }

    const btnStyleZh = popover.querySelector('#opt-style-zh');
    const btnStyleEn = popover.querySelector('#opt-style-en');
    if (btnStyleZh) {
      btnStyleZh.onclick = (e) => {
        e.stopPropagation();
        saveConfig({ timeStyle: 'zh' });
        renderSettingsView(popover);
      };
    }
    if (btnStyleEn) {
      btnStyleEn.onclick = (e) => {
        e.stopPropagation();
        saveConfig({ timeStyle: 'en' });
        renderSettingsView(popover);
      };
    }
  }

  function updateTopPill(parsed) {
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

      // 悬停事件：仅当配置为 hover 时触发展开
      pill.addEventListener('mouseenter', () => {
        if (config.triggerMode === 'hover') {
          openPopover(pill, false);
        }
      });

      pill.addEventListener('mouseleave', () => {
        if (config.triggerMode === 'hover') {
          scheduleHidePopover();
        }
      });

      // 单击事件：无论当前是什么模式，单击都可以切换常驻展开 / 收起
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const popover = document.getElementById('agy-quota-popover');
        const isCurrentlyVisible = popover && popover.style.display === 'block' && popover.style.opacity === '1';

        if (isCurrentlyVisible && isPopoverPinned) {
          closePopover();
        } else {
          openPopover(pill, true);
          refreshAll(true);
        }
      });

      // 按压微动效
      pill.addEventListener('mousedown', () => {
        pill.style.transform = 'scale(0.96)';
      });
      pill.addEventListener('mouseup', () => {
        pill.style.transform = 'scale(1)';
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

  function renderAll() {
    if (!quotaData) {
      refreshAll(false);
    } else {
      const parsed = parseQuota(quotaData);
      updateTopPill(parsed);
      renderPopoverContent(parsed);
    }
  }

  async function refreshAll(force = false) {
    const data = await fetchQuota(force);
    const parsed = parseQuota(data);
    updateTopPill(parsed);
    renderPopoverContent(parsed);
  }

  function setupPollingTimer() {
    if (pollIntervalTimer) {
      clearInterval(pollIntervalTimer);
      pollIntervalTimer = null;
    }
    const sec = config.refreshInterval;
    if (sec > 0) {
      pollIntervalTimer = setInterval(() => {
        const now = Date.now();
        if (!quotaData || now - lastFetchTime >= (sec - 1) * 1000) {
          refreshAll(false);
        }
      }, sec * 1000);
    }
  }

  // 点击外部收起
  function onDocumentClick(e) {
    const pill = document.getElementById('agy-model-quota-topbar');
    const popover = document.getElementById('agy-quota-popover');
    if (pill && pill.contains(e.target)) return;
    if (popover && popover.contains(e.target)) return;
    closePopover();
  }
  document.addEventListener('click', onDocumentClick, true);

  // 保证不残留输入框徽标
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
      if (!topPill) {
        renderAll();
      }
    }, 150);
  });

  // 安全启动：兼容 document-start、loading 与已完成阶段
  function startObserverAndMount() {
    const root = document.body || document.documentElement;
    if (root) {
      try {
        observer.observe(root, { childList: true, subtree: true });
      } catch (_) {}
    }
    refreshAll();
    setupPollingTimer();

    // 兜底挂载机制：初次启动前 10 秒每 1 秒确认一次挂载情况
    let retryCount = 0;
    const retryTimer = setInterval(() => {
      retryCount++;
      const pill = document.getElementById('agy-model-quota-topbar');
      if (!pill) {
        renderAll();
      }
      if (pill || retryCount >= 10) {
        clearInterval(retryTimer);
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserverAndMount);
  } else {
    startObserverAndMount();
  }

  const onFocus = () => refreshAll(false);
  window.addEventListener('focus', onFocus);

  window.__AGY_QUOTA_CLEANUP__ = () => {
    stopPopoverTickTimer();
    observer.disconnect();
    document.removeEventListener('click', onDocumentClick, true);
    if (pollIntervalTimer) clearInterval(pollIntervalTimer);
    window.removeEventListener('focus', onFocus);
    const p = document.getElementById('agy-model-quota-topbar');
    if (p) p.remove();
    const pop = document.getElementById('agy-quota-popover');
    if (pop) pop.remove();
  };
})();
