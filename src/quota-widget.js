/**
 * Antigravity Real-Time Model Quota Indicator Widget
 * 实时模型余量显示组件 - 常驻顶部标题栏（支持设置选项、时间风格定制与触发模式切换）
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
    // 重启定时器
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

  async function fetchQuota(force = false) {
    if (isFetching && !force) return quotaData;
    const now = Date.now();
    if (!force && quotaData && now - lastFetchTime < 4000) {
      return quotaData;
    }

    const csrfToken = window.__APP_CONFIG__?.csrfToken;
    if (!csrfToken) return null;

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
    if (!data?.response?.groups) return null;
    const groups = data.response.groups;

    const gemini = groups.find(g => g.displayName?.includes('Gemini')) || groups[0];
    const g5h = gemini?.buckets?.find(b => b.window === '5h');
    const gW = gemini?.buckets?.find(b => b.window === 'weekly');

    const tp = groups.find(g => g.displayName?.includes('Claude') || g.displayName?.includes('3p'));
    const t5h = tp?.buckets?.find(b => b.window === '5h');
    const tW = tp?.buckets?.find(b => b.window === 'weekly');

    return {
      gemini: {
        name: gemini?.displayName || 'Gemini 模型',
        desc: gemini?.description || 'Pro & Flash 共享',
        p5h: g5h ? Math.round(g5h.remainingFraction * 100) : 100,
        pW: gW ? Math.round(gW.remainingFraction * 100) : 100,
        reset5h: g5h?.resetTime,
        resetW: gW?.resetTime
      },
      thirdParty: tp ? {
        name: tp.displayName || 'Claude 与 GPT 模型',
        desc: tp.description || '第三方模型',
        p5h: t5h ? Math.round(t5h.remainingFraction * 100) : 100,
        pW: tW ? Math.round(tW.remainingFraction * 100) : 100,
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
    if (h === 0 && m === 0) {
      return style === 'zh' ? '即将重置' : 'Resetting';
    }
    if (style === 'en') {
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    return h > 0 ? `${h}小时${m}分钟` : `${m}分钟`;
  }

  // 格式化 7 天限额重置倒计时：？天？小时 或 ？d ？h
  function formatWeeklyReset(isoStr, style) {
    if (!isoStr) return '-';
    const diffMs = new Date(isoStr).getTime() - Date.now();
    if (diffMs <= 0) return style === 'zh' ? '即将重置' : 'Resetting';
    const totalHours = Math.floor(diffMs / 3600000);
    const d = Math.floor(totalHours / 24);
    const h = totalHours % 24;
    if (d === 0 && h === 0) {
      return style === 'zh' ? '< 1小时' : '< 1h';
    }
    if (style === 'en') {
      return d > 0 ? `${d}d ${h}h` : `${h}h`;
    }
    return d > 0 ? `${d}天${h}小时` : `${h}小时`;
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
        'font-family: inherit'
      ].join(';');

      popover.addEventListener('mouseenter', () => {
        if (hidePopoverTimer) clearTimeout(hidePopoverTimer);
      });
      popover.addEventListener('mouseleave', () => {
        // 如果处于设置视图或已点击固定，不自动隐藏
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

  function openPopover(targetElement, pin = false) {
    if (hidePopoverTimer) clearTimeout(hidePopoverTimer);
    if (pin) isPopoverPinned = true;

    const popover = getOrCreatePopover();
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

  function closePopover() {
    isPopoverPinned = false;
    currentCardView = 'quota'; // 收起后重置为配额视图
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
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px;">
          <span>⚡ 模型用量与配额</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button id="agy-quota-refresh-action" title="立即刷新配额" style="-webkit-app-region:no-drag;cursor:pointer;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:var(--foreground,#fff);font-size:11px;padding:3px 8px;border-radius:6px;display:flex;align-items:center;gap:3px;transition:background 0.2s;">
            🔄 刷新
          </button>
          <button id="agy-quota-settings-action" title="插件参数设置" style="-webkit-app-region:no-drag;cursor:pointer;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:var(--foreground,#fff);font-size:11px;padding:3px 8px;border-radius:6px;display:flex;align-items:center;gap:3px;transition:background 0.2s;">
            ⚙️ 设置
          </button>
        </div>
      </div>

      <!-- Gemini Section -->
      <div style="margin-bottom:12px;">
        <div style="font-weight:500;color:var(--foreground,#fff);margin-bottom:6px;display:flex;justify-content:space-between;">
          <span>${g.name}</span>
          <span style="font-size:11px;opacity:0.6;">Pro & Flash 共享</span>
        </div>

        <!-- 5h limit -->
        <div style="margin-bottom:7px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;opacity:0.85;">
            <span>${style === 'zh' ? '5小时限额' : '5-Hour Limit'}</span>
            <span><strong style="color:${getStatusColor(g.p5h)}">${g.p5h}%</strong> · ${g5hText}</span>
          </div>
          <div style="height:5px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
            <div style="width:${g.p5h}%;height:100%;background:${getStatusColor(g.p5h)};border-radius:3px;transition:width 0.3s ease;"></div>
          </div>
        </div>

        <!-- Weekly limit -->
        <div>
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;opacity:0.85;">
            <span>${style === 'zh' ? '七天限额' : 'Weekly Limit'}</span>
            <span><strong style="color:${getStatusColor(g.pW)}">${g.pW}%</strong> · ${gWText}</span>
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
        <div style="padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);margin-bottom:8px;">
          <div style="font-weight:500;color:var(--foreground,#fff);margin-bottom:6px;display:flex;justify-content:space-between;">
            <span>${tp.name}</span>
            <span style="font-size:11px;opacity:0.6;">第三方模型</span>
          </div>

          <div style="margin-bottom:7px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;opacity:0.85;">
              <span>${style === 'zh' ? '5小时限额' : '5-Hour Limit'}</span>
              <span><strong style="color:${getStatusColor(tp.p5h)}">${tp.p5h}%</strong> · ${tp5hText}</span>
            </div>
            <div style="height:5px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
              <div style="width:${tp.p5h}%;height:100%;background:${getStatusColor(tp.p5h)};border-radius:3px;transition:width 0.3s ease;"></div>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;opacity:0.85;">
              <span>${style === 'zh' ? '七天限额' : 'Weekly Limit'}</span>
              <span><strong style="color:${getStatusColor(tp.pW)}">${tp.pW}%</strong> · ${tpWText}</span>
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

    // 绑定刷新与设置按钮
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
        isPopoverPinned = true;
        renderSettingsView(popover);
      };
    }
  }

  // 设置菜单视图
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
        <span style="font-weight:600;font-size:13px;">⚙️ 插件参数设置</span>
        <span style="width:36px;"></span>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;font-size:12px;">
        <!-- 1. 展开触发方式 -->
        <div>
          <div style="font-weight:500;margin-bottom:6px;opacity:0.9;display:flex;justify-content:space-between;">
            <span>展开触发方式</span>
            <span style="font-size:10px;opacity:0.5;">${isClick ? '当前: 单击' : '当前: 悬停'}</span>
          </div>
          <div style="display:flex;gap:6px;">
            <button id="opt-trigger-click" class="agy-cfg-btn" style="flex:1;padding:6px 8px;border-radius:6px;font-size:11px;cursor:pointer;-webkit-app-region:no-drag;transition:all 0.15s;${isClick ? activeBtnStyle : normalBtnStyle}">
              👆 单击展开
            </button>
            <button id="opt-trigger-hover" class="agy-cfg-btn" style="flex:1;padding:6px 8px;border-radius:6px;font-size:11px;cursor:pointer;-webkit-app-region:no-drag;transition:all 0.15s;${isHover ? activeBtnStyle : normalBtnStyle}">
              🖱️ 悬停展开
            </button>
          </div>
        </div>

        <!-- 2. 自动刷新周期 -->
        <div>
          <div style="font-weight:500;margin-bottom:6px;opacity:0.9;">自动刷新时间周期</div>
          <select id="opt-refresh-select" style="width:100%;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.08);color:var(--foreground,#e5e7eb);border:1px solid rgba(255,255,255,0.15);font-size:11px;cursor:pointer;-webkit-app-region:no-drag;outline:none;">
            <option value="30" ${config.refreshInterval === 30 ? 'selected' : ''}>30 秒</option>
            <option value="60" ${config.refreshInterval === 60 ? 'selected' : ''}>60 秒 (默认推荐)</option>
            <option value="120" ${config.refreshInterval === 120 ? 'selected' : ''}>2 分钟</option>
            <option value="300" ${config.refreshInterval === 300 ? 'selected' : ''}>5 分钟</option>
            <option value="0" ${config.refreshInterval === 0 ? 'selected' : ''}>仅手动刷新 (关闭自动)</option>
          </select>
        </div>

        <!-- 3. 限额显示风格 -->
        <div>
          <div style="font-weight:500;margin-bottom:6px;opacity:0.9;display:flex;justify-content:space-between;">
            <span>限额倒计时显示风格</span>
            <span style="font-size:10px;opacity:0.5;">${isZh ? '中文风格' : '英文风格'}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <button id="opt-style-zh" class="agy-cfg-btn" style="text-align:left;padding:7px 10px;border-radius:6px;font-size:11px;cursor:pointer;-webkit-app-region:no-drag;transition:all 0.15s;${isZh ? activeBtnStyle : normalBtnStyle}">
              中文格式: <strong>4小时23分钟</strong> · <strong>5天18小时</strong>
            </button>
            <button id="opt-style-en" class="agy-cfg-btn" style="text-align:left;padding:7px 10px;border-radius:6px;font-size:11px;cursor:pointer;-webkit-app-region:no-drag;transition:all 0.15s;${isEn ? activeBtnStyle : normalBtnStyle}">
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

    // 绑定返回
    const backBtn = popover.querySelector('#agy-settings-back');
    const doneBtn = popover.querySelector('#agy-settings-done');
    const goBack = () => {
      currentCardView = 'quota';
      const parsed = parseQuota(quotaData);
      renderQuotaView(popover, parsed);
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

    pill.innerHTML = `
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dotColor};box-shadow: 0 0 6px ${dotColor}88;"></span>
      <span style="font-weight:500;opacity:0.9;">Gemini:</span>
      <span style="font-weight:600;color:${g.p5h < 20 ? '#ef4444' : 'var(--primary, #38bdf8)'}">${g.p5h}%</span>
      <span style="font-size:10px;opacity:0.5;margin-left:-4px;">(5h)</span>
      <span style="opacity:0.3;">/</span>
      <span style="font-weight:600;color:${g.pW < 20 ? '#ef4444' : 'var(--accent, #a78bfa)'}">${g.pW}%</span>
      <span style="font-size:10px;opacity:0.5;margin-left:-4px;">(${labelW})</span>
    `;

    const tip = config.triggerMode === 'click' ? '单击展开/收起详情面板' : '悬停预览，单击常开详情面板';
    pill.title = `Gemini 剩余配额: 5h ${g.p5h}% | 周 ${g.pW}%\n${tip}`;
  }

  function renderAll() {
    const parsed = parseQuota(quotaData);
    updateTopPill(parsed);
    renderPopoverContent(parsed);
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
      pollIntervalTimer = setInterval(() => refreshAll(false), sec * 1000);
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

  observer.observe(document.body, { childList: true, subtree: true });

  // 立即启动
  refreshAll();
  setupPollingTimer();

  const onFocus = () => refreshAll(false);
  window.addEventListener('focus', onFocus);

  window.__AGY_QUOTA_CLEANUP__ = () => {
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
