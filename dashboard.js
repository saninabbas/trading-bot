/* ═══════════════════════════════════════════════════════
   dashboard.js — Clean Dashboard Logic
   Handles: navigation, API settings, bot control, trade log
   ═══════════════════════════════════════════════════════ */

let currentPage    = 'overview';
let selectedStrat  = 'RSI+EMA';
let botActive      = false;
let tradeLog       = [];
let allTrades      = [];
let currentFilter  = 'all';

// ── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initDashListeners();
  startClock();
  await loadAllData();
  startHeartbeatPulse();
  listenToBackground();
  await syncActiveTrade();
});

// ── Event Listeners ───────────────────────────────────────
function initDashListeners() {
  document.addEventListener('click', (e) => {
    // 1. Navigation Links
    const navLink = e.target.closest('.nav-link');
    if (navLink) { showPage(navLink.dataset.page, navLink); return; }

    // 2. Strategy Cards
    const stratCard = e.target.closest('.strategy-big-card');
    if (stratCard) {
      selectBigStrategy(stratCard, stratCard.dataset.strat);
      stratCard.style.transform = 'scale(0.95)';
      setTimeout(() => stratCard.style.transform = '', 100);
      return;
    }

    // 3. Bot Control
    if (e.target.id === 'big-start-btn')  { toggleBotDashboard(); return; }
    if (e.target.id === 'save-api-btn')   { saveApiKeys(); return; }
    if (e.target.id === 'test-conn-btn')  { testConnection(); return; }
    if (e.target.id === 'close-pos-btn')  { forceClosePosition(); return; }

    // 4. Filters & Logs
    const filterBtn = e.target.closest('.filter-btn');
    if (filterBtn) { filterLog(filterBtn.dataset.filter, filterBtn); return; }

    const clearBtn = e.target.closest('.clear-btn');
    if (clearBtn && (clearBtn.id === 'mini-clear-log-btn' || clearBtn.id === 'full-clear-log-btn')) {
      clearLog(); return;
    }

    // 5. Visibility Toggle (eye buttons)
    const eyeBtn = e.target.closest('.eye-btn');
    if (eyeBtn) { toggleVis(eyeBtn.dataset.target, eyeBtn); return; }
  });

  // Leverage slider
  const leverRange = document.getElementById('lever-range');
  if (leverRange) {
    leverRange.addEventListener('input', function() {
      updateLeverage(this.value);
    });
  }
}

// ── Clock ─────────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('db-time');
  const tick = () => {
    const now = new Date();
    el.textContent = now.toUTCString().slice(17, 25) + ' UTC';
  };
  tick(); setInterval(tick, 1000);
}

// ── Load persisted data ───────────────────────────────────
async function loadAllData() {
  const data = await chrome.storage.local.get([
    'botRunning', 'selectedStrategy', 'stats',
    'tradeLog', 'apiKey', 'apiSecret', 'useTestnet', 'geminiKey', 'autoRisk'
  ]);

  if (data.botRunning) {
    botActive = true;
    applyBotUI(true);
  }
  if (data.selectedStrategy) {
    selectedStrat = data.selectedStrategy;
    highlightStrategy(selectedStrat);
  }
  if (data.stats) updateDashboardStats(data.stats);
  if (data.tradeLog) {
    tradeLog = data.tradeLog;
    allTrades = [...tradeLog];
    renderLogList();
    renderFullLog();
  }
  
  const keyEl = document.getElementById('api-key');
  const secEl = document.getElementById('api-secret');
  const geminiEl = document.getElementById('gemini-key');
  const testnetEl = document.getElementById('use-testnet');
  const modeEl = document.getElementById('d-mode');

  if (keyEl && data.apiKey) keyEl.value = data.apiKey;
  if (secEl && data.apiSecret) secEl.value = data.apiSecret;
  if (geminiEl && data.geminiKey) geminiEl.value = data.geminiKey;
  
  if (testnetEl) {
    testnetEl.value = data.useTestnet !== false ? 'true' : 'false';
    if (modeEl) {
      const liveOption = modeEl.options[1];
      if (data.useTestnet !== false) {
        liveOption.textContent = '🚀 Live on Testnet (Safe)';
      } else {
        liveOption.textContent = '🔴 Live Trading (REAL MONEY)';
      }
    }
  }
}

// ── Heartbeat Pulse: Drives Live Updates & Keeps Bot Awake ──
function startHeartbeatPulse() {
  setInterval(async () => {
    const data = await chrome.storage.local.get(['stats', 'tradeLog', 'botRunning', 'activeTrade']);
    if (data.stats) updateDashboardStats(data.stats);
    
    if (data.tradeLog && data.tradeLog.length !== tradeLog.length) {
      tradeLog  = data.tradeLog;
      allTrades = [...tradeLog];
      renderLogList();
      renderFullLog();
    }

    if (data.botRunning) {
      chrome.runtime.sendMessage({ action: 'HEARTBEAT', strategy: selectedStrat }).catch(()=>{});
    }

    if (data.activeTrade) {
      updateActivePositionUI(data.activeTrade);
    } else {
      updateActivePositionUI(null);
    }
  }, 15000);
}

// ── Listen to background messages ────────────────────────
function listenToBackground() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'TRADE_EXECUTED') {
      tradeLog.unshift(msg.trade);
      allTrades = [...tradeLog];
      renderLogList();
      renderFullLog();
      updateDashboardStats(msg.stats);
      showToast(`✅ ${msg.trade.type} ${msg.trade.symbol} → P&L: ${msg.trade.pnl > 0 ? '+' : ''}$${msg.trade.pnl.toFixed(2)}`);
    }
    if (msg.action === 'BOT_STATUS') {
      botActive = msg.running;
      applyBotUI(msg.running, msg.statusText, msg.strategy, msg.lastScan);
    }
    if (msg.action === 'POSITION_UPDATE') {
      updateActivePositionUI(msg.position);
    }
    if (msg.action === 'STRATEGY_CHANGED') {
      selectedStrat = msg.newStrategy;
      highlightStrategy(msg.newStrategy);
      showToast(`🔄 Auto-Switch: Using ${msg.newStrategy}`, false);
    }
    if (msg.action === 'TARGET_REACHED') {
      showToast(`🎯 Daily Target Hit! Securing profits.`, false);
    }
    if (msg.action === 'HEARTBEAT') {
      const pulse = document.getElementById('heartbeat-pulse');
      if (pulse) {
        pulse.style.display = 'inline-block';
        pulse.style.color = '#22d3ee';
        setTimeout(() => { pulse.style.color = 'transparent'; }, 500);
      }
    }
  });
}

// ── Page Navigation ───────────────────────────────────────
function showPage(name, navEl) {
  const targetPage = document.getElementById('page-' + name);
  if (!targetPage) return;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
  
  targetPage.classList.add('active');
  if (navEl) navEl.classList.add('active');
  
  currentPage = name;
  const titles = {
    overview: ['Overview', 'Live trading dashboard'],
    trades:   ['Trade Log', 'Full trading history'],
    settings: ['Settings', 'Configure API keys & connection']
  };

  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-subtitle');
  if (titleEl && titles[name]) titleEl.textContent = titles[name][0];
  if (subEl && titles[name]) subEl.textContent = titles[name][1];
}

// ── Dashboard Stats ───────────────────────────────────────
function updateDashboardStats(stats) {
  setVal('d-balance', parseFloat(stats.balance || 0).toFixed(2));
  const pnl = parseFloat(stats.todayPnl || 0);
  const pnlEl = document.getElementById('d-pnl');
  pnlEl.textContent = (pnl >= 0 ? '+' : '') + pnl.toFixed(2);
  pnlEl.className   = 'stat-card-value ' + (pnl >= 0 ? 'cyan-val' : 'red-val');
  const pct = stats.balance > 0 ? ((pnl / stats.balance) * 100).toFixed(2) : 0;
  const pctEl = document.getElementById('d-pnl-pct');
  pctEl.textContent = (pnl >= 0 ? '+' : '') + pct + '%';
  pctEl.className   = pnl >= 0 ? 'stat-card-sub up' : 'stat-card-sub down';

  if (stats.winRate !== undefined) {
    setVal('d-winrate', stats.winRate + '%');
    setVal('d-winrate-sub', `${stats.wins || 0}W / ${stats.losses || 0}L`);
  }
  if (stats.totalTrades !== undefined) {
    setVal('d-total-trades', stats.totalTrades);
    setVal('d-active-sub',   `${stats.activeTrades || 0} active`);
  }
  const sbStrat = document.getElementById('sb-strategy');
  if (sbStrat) sbStrat.textContent = selectedStrat || 'No strategy';
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Bot Control ───────────────────────────────────────────
async function toggleBotDashboard() {
  const data = await chrome.storage.local.get(['apiKey']);
  if (!data.apiKey) {
    showToast('⚠️ Please save API Keys first!', true);
    showPage('settings', document.querySelectorAll('.nav-link')[2]);
    return;
  }

  const settings = getTradeSettings();
  const targetState = !botActive;

  if (targetState) {
    // Attempting to START
    chrome.runtime.sendMessage({
      action: 'START_BOT',
      strategy: selectedStrat,
      settings
    }, async (res) => {
      if (chrome.runtime.lastError) {
        showToast('❌ Background communication error', true);
        return;
      }
      if (res && res.ok) {
        botActive = true;
        applyBotUI(true);
        await chrome.storage.local.set({ 
          botRunning: true, 
          selectedStrategy: selectedStrat, 
          savedSettings: settings,
          autoRisk: settings.autoRisk 
        });
        showToast(`🚀 Bot started — ${selectedStrat}`);
      } else {
        const errMsg = (res && res.error) ? res.error : 'License required or API error';
        showToast(`⚠️ Failed to start: ${errMsg}`, true);
        botActive = false;
        applyBotUI(false);
      }
    });
  } else {
    // Attempting to STOP
    chrome.runtime.sendMessage({ action: 'STOP_BOT' }, async () => {
      botActive = false;
      applyBotUI(false);
      await chrome.storage.local.set({ botRunning: false });
      showToast('⛔ Bot stopped');
    });
  }
}

function getTradeSettings() {
  return {
    symbol:    document.getElementById('d-symbol')?.value    || 'BTCUSDT',
    amount:    document.getElementById('d-amount')?.value    || '50',
    autoRisk:  document.getElementById('d-auto-risk')?.checked || false,
    risk:      '2',
    leverage:  document.getElementById('lever-range')?.value || '20',
    stopLoss:  document.getElementById('d-sl')?.value        || '0.5',
    takeProfit:document.getElementById('d-tp')?.value        || '1.0',
    trailingSl:'0',
    autoCompound: false,
    dailyTarget: '20',
    autoSwitch: false,
    mode:      document.getElementById('d-mode')?.value      || 'paper'
  };
}

function applyBotUI(running, statusText = null, activeStrat = null, lastScan = null) {
  const bigDot  = document.getElementById('big-dot');
  const bigTxt  = document.getElementById('big-status-text');
  const bigBtn  = document.getElementById('big-start-btn');
  const sbDot   = document.getElementById('sb-dot');
  const sbStatus= document.getElementById('sb-status');

  const lastCheckEl = document.getElementById('sb-last-check');

  if (running) {
    bigDot.className  = 'dot-lg on';
    bigTxt.textContent= statusText || 'BOT RUNNING';
    if (sbStatus) sbStatus.textContent = statusText || 'Bot Online';
    
    bigBtn.className  = 'btn-stop-big';
    bigBtn.innerHTML  = '⛔ STOP BOT';
    sbDot.className   = 'dot-sm on';

    if (lastScan && lastCheckEl) {
      const timeStr = new Date(lastScan).toLocaleTimeString().slice(0, 8);
      lastCheckEl.style.display = 'block';
      lastCheckEl.textContent = '● Last: ' + timeStr;
      lastCheckEl.style.color = 'var(--cyan)';
      setTimeout(() => lastCheckEl.style.color = '#94a3b8', 1000);
    }
  } else {
    bigDot.className  = 'dot-lg off';
    bigTxt.textContent= 'BOT OFFLINE';
    if (sbStatus) sbStatus.textContent = 'Bot Offline';
    
    bigBtn.className  = 'btn-start-big';
    bigBtn.innerHTML  = '▶ START BOT ⚡';
    sbDot.className   = 'dot-sm off';
    
    if (lastCheckEl) lastCheckEl.style.display = 'none';
  }

  // Update Topbar Trading Mode Badge
  const topBadge = document.querySelector('.badge-live');
  const modeVal = document.getElementById('d-mode')?.value;
  const isTestnet = document.getElementById('use-testnet')?.value === 'true';

  if (topBadge) {
    if (modeVal === 'live') {
      if (isTestnet) {
        topBadge.innerHTML = '<div class="dot-sm on" style="background:var(--cyan)"></div> TESTNET LIVE';
        topBadge.style.borderColor = 'var(--cyan)';
        topBadge.style.color = 'var(--cyan)';
      } else {
        topBadge.innerHTML = '<div class="dot-sm on" style="background:var(--red)"></div> REAL MONEY LIVE';
        topBadge.style.borderColor = 'var(--red)';
        topBadge.style.color = 'var(--red)';
        topBadge.classList.add('pulse-red');
      }
    } else {
      topBadge.innerHTML = '<div class="dot-sm off"></div> PAPER TRADING';
      topBadge.style.borderColor = 'var(--border)';
      topBadge.style.color = 'var(--muted)';
      topBadge.classList.remove('pulse-red');
    }
  }
}

function selectBigStrategy(el, strategy) {
  document.querySelectorAll('.strategy-big-card').forEach(c => {
    c.className = 'strategy-big-card';
  });
  const classMap = { 'RSI+EMA':'sel-rsi', MACD:'sel-macd', Scalping:'sel-scalp', 'Deep AI':'sel-ai' };
  el.classList.add(classMap[strategy] || '');
  selectedStrat = strategy;

  chrome.storage.local.remove(['selectedStrategy'], () => {
    chrome.storage.local.set({ selectedStrategy: strategy });
  });

  document.getElementById('big-strategy-text').textContent = `Strategy: ${strategy}`;
  document.getElementById('sb-strategy').textContent = strategy;

  chrome.runtime.sendMessage({ action: 'UPDATE_STRATEGY', strategy });
}

function highlightStrategy(strat) {
  const map = { 'RSI+EMA':'sel-rsi', MACD:'sel-macd', Scalping:'sel-scalp', 'Deep AI':'sel-ai' };
  document.querySelectorAll('.strategy-big-card').forEach(c => {
    c.className = 'strategy-big-card';
    if (c.dataset.strat === strat) c.classList.add(map[strat] || '');
  });
  selectedStrat = strat;
  document.getElementById('big-strategy-text').textContent = `Strategy: ${strat}`;
  const sideStrat = document.getElementById('sb-strategy');
  if (sideStrat) sideStrat.textContent = strat;
}

// ── Leverage Slider ───────────────────────────────────────
function updateLeverage(val) {
  document.getElementById('lever-val').textContent = val + 'x';
}

// ── Trade Log — Mini List ─────────────────────────────────
function renderLogList() {
  const container = document.getElementById('log-list');
  if (!tradeLog.length) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">No trades yet. Start the bot to begin trading.</div>';
    return;
  }
  container.innerHTML = tradeLog.slice(0, 10).map(t => `
    <div class="log-item">
      <span class="log-type ${t.direction === 'LONG' ? 'long' : 'short'}">${t.direction}</span>
      <span style="font-weight:600">${t.symbol}</span>
      <span style="color:var(--muted)">${t.strategy}</span>
      <span class="log-pnl ${t.pnl >= 0 ? 'pos' : 'neg'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</span>
      <span class="log-time">${t.time}</span>
    </div>
  `).join('');
}

// ── Trade Log — Full Table ────────────────────────────────
function renderFullLog(filter = currentFilter) {
  const tbody = document.getElementById('full-log-body');
  let data = [...allTrades];
  if (filter === 'LONG')  data = data.filter(t => t.direction === 'LONG');
  if (filter === 'SHORT') data = data.filter(t => t.direction === 'SHORT');
  if (filter === 'win')   data = data.filter(t => t.pnl > 0);
  if (filter === 'loss')  data = data.filter(t => t.pnl <= 0);

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--muted)">No trades match this filter.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(t => `
    <tr>
      <td><span class="log-type ${t.direction === 'LONG' ? 'long' : 'short'}">${t.direction}</span></td>
      <td style="font-weight:700">${t.symbol}</td>
      <td style="font-family:'JetBrains Mono',monospace">${t.entry}</td>
      <td style="font-family:'JetBrains Mono',monospace">${t.exit}</td>
      <td class="log-pnl ${t.pnl >= 0 ? 'pos' : 'neg'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</td>
      <td style="color:var(--muted)">${t.strategy}</td>
      <td class="log-time">${t.time}</td>
    </tr>
  `).join('');
}

function filterLog(type, btn) {
  currentFilter = type;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderFullLog(type);
}

async function clearLog() {
  if (!confirm('Clear all trade history?')) return;
  tradeLog = []; allTrades = [];
  await chrome.storage.local.set({ tradeLog: [] });
  renderLogList(); renderFullLog();
  showToast('🗑️ Trade log cleared');
}

// ── API Settings ──────────────────────────────────────────
async function saveApiKeys() {
  const key    = document.getElementById('api-key').value.trim();
  const secret = document.getElementById('api-secret').value.trim();
  const testnet= document.getElementById('use-testnet').value;
  const gemini = document.getElementById('gemini-key') ? document.getElementById('gemini-key').value.trim() : '';
  if (!key || !secret) { showToast('⚠️ Please enter both API Key and Secret', true); return; }
  
  const isTestnet = testnet === 'true';

  await chrome.storage.local.set({ 
    apiKey: key, 
    apiSecret: secret, 
    useTestnet: isTestnet, 
    geminiKey: gemini
  });
  
  const modeEl = document.getElementById('d-mode');
  if (modeEl) {
    const liveOption = modeEl.options[1];
    liveOption.textContent = isTestnet ? '🚀 Live on Testnet (Safe)' : '🔴 Live Trading (REAL MONEY)';
  }

  showToast('✅ API Keys & Mode saved!');
  chrome.runtime.sendMessage({ 
    action: 'UPDATE_KEYS', 
    apiKey: key, 
    apiSecret: secret, 
    useTestnet: isTestnet, 
    geminiKey: gemini
  });
}

async function testConnection() {
  const data = await chrome.storage.local.get(['apiKey', 'apiSecret', 'useTestnet']);
  if (!data.apiKey) { showToast('⚠️ Save API Keys first!', true); return; }
  const el = document.getElementById('conn-status');

  const baseUrl = data.useTestnet === false ? 'https://fapi.binance.com' : 'https://testnet.binancefuture.com';
  el.textContent = '🔄 Testing network ping...';
  el.style.color = 'var(--amber)';

  try {
    const pingRes = await fetchWithTimeout(`${baseUrl}/fapi/v1/ping`, {}, 5000);
    if (!pingRes.ok) throw new Error('Ping failed (HTTP ' + pingRes.status + ')');
    el.textContent = '🔄 Ping OK. Checking API keys...';
  } catch (err) {
    el.textContent = `❌ Network Blocked: Cannot reach Binance. Use VPN! (${err.message})`;
    el.style.color = 'var(--red)';
    showToast('❌ Network blocked — enable VPN', true);
    return;
  }

  try {
    // Sync with Binance time first
    const timeRes = await fetch(`${baseUrl}/fapi/v1/time`);
    const timeData = await timeRes.json();
    const ts = timeData.serverTime;
    
    const query = `timestamp=${ts}`;
    const key  = data.apiKey.trim();
    const sec  = data.apiSecret.trim();

    const enc  = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(sec), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig  = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(query));
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    const balRes = await fetchWithTimeout(`${baseUrl}/fapi/v2/balance?${query}&signature=${sigHex}`, {
      headers: { 'X-MBX-APIKEY': key }
    }, 8000);

    if (!balRes.ok) {
      const errData = await balRes.json().catch(() => ({}));
      throw new Error(errData.msg || `HTTP ${balRes.status}`);
    }

    const balData = await balRes.json();
    const usdt = Array.isArray(balData) ? balData.find(b => b.asset === 'USDT') : null;
    const balance = usdt ? parseFloat(usdt.balance).toFixed(2) : '?';

    el.textContent = `✅ Connected! Balance: ${balance} USDT (${data.useTestnet === false ? 'Live' : 'Testnet'})`;
    el.style.color = 'var(--green)';
    showToast('✅ Binance API connected successfully!');
  } catch (err) {
    el.textContent = `❌ API Error: ${err.message}`;
    el.style.color = 'var(--red)';
    showToast('❌ API Test failed: ' + err.message, true);
  }
}

function toggleVis(id, btn) {
  const inp = document.getElementById(id);
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else                         { inp.type = 'password'; btn.textContent = '👁'; }
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = isError ? 'toast show error' : 'toast show';
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Position Helper Functions ────────────────────────────
async function forceClosePosition() {
  const btn = document.getElementById('close-pos-btn');
  const originalText = btn ? btn.innerHTML : '✖ CLOSE POSITION';
  if (btn) { 
    btn.disabled = true; 
    btn.innerHTML = '<span class="status-mini-glow"></span> CLOSING...';
    btn.classList.add('btn-loading');
  }

  const safetyTimer = setTimeout(() => {
    if (btn) { 
      btn.disabled = false; 
      btn.innerHTML = '💥 FORCE CLEAR'; 
      btn.style.borderColor = 'var(--red)';
      btn.style.color = 'var(--red)';
      btn.onclick = async () => {
        if (!confirm('Force clear will remove the trade from the bot locally. Proceed?')) return;
        chrome.runtime.sendMessage({ action: 'FORCE_CLEAR_TRADE' }, () => {
          updateActivePositionUI(null);
          showToast('💥 Local record purged.', true);
          btn.onclick = forceClosePosition;
        });
      };
    }
    showToast('⚠️ Close taking longer than expected...', true);
  }, 6000);

  chrome.runtime.sendMessage({ action: 'CLOSE_POSITION' }, (res) => {
    clearTimeout(safetyTimer);
    if (btn) { 
      btn.disabled = false; 
      btn.innerHTML = originalText;
      btn.classList.remove('btn-loading');
    }

    if (chrome.runtime.lastError) {
      showToast('❌ Background error: ' + chrome.runtime.lastError.message, true);
      return;
    }

    if (res && res.ok) {
      showToast('✅ Position closed successfully.');
      updateActivePositionUI(null);
    } else {
      const err = (res ? res.error : 'No response');
      showToast('❌ Close failed: ' + err, true);
      
      if (btn) {
        btn.innerHTML = '💥 FORCE CLEAR';
        btn.classList.add('pulse-red');
        btn.onclick = async () => {
           chrome.runtime.sendMessage({ action: 'FORCE_CLEAR_TRADE' }, () => {
             updateActivePositionUI(null);
             btn.onclick = forceClosePosition;
           });
        };
      }
    }
  });
}

async function syncActiveTrade() {
  const data = await chrome.storage.local.get(['activeTrade']);
  updateActivePositionUI(data.activeTrade || null);
}

function updateActivePositionUI(pos) {
  const wrap = document.getElementById('active-position-wrap');
  if (!wrap) return;
  
  if (!pos) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'block';
  document.getElementById('ap-symbol').textContent = pos.symbol;
  document.getElementById('ap-entry').textContent  = parseFloat(pos.entry).toFixed(2);
  document.getElementById('ap-mark').textContent   = parseFloat(pos.markPrice).toFixed(2);
  document.getElementById('ap-sl').textContent     = parseFloat(pos.sl).toFixed(2);
  document.getElementById('ap-tp').textContent     = parseFloat(pos.tp).toFixed(2);
  
  const pnlEl = document.getElementById('ap-pnl');
  const pctEl = document.getElementById('ap-pnl-pct');
  const badge = document.getElementById('ap-badge');

  pnlEl.classList.remove('pulse-lite');
  void pnlEl.offsetWidth;
  pnlEl.classList.add('pulse-lite');

  const dir = pos.direction || 'LONG';
  badge.textContent = dir;
  badge.className = 'pos-badge ' + dir.toLowerCase();

  const amtEl = document.getElementById('ap-amount');
  if (amtEl) amtEl.textContent = parseFloat(pos.amount || 0).toFixed(2);

  const pnl = parseFloat(pos.pnl);
  pnlEl.textContent = (pnl >= 0 ? '+' : '-') + '$' + Math.abs(pnl).toFixed(2);
  pnlEl.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
  
  pctEl.textContent = (pnl >= 0 ? '+' : '') + pos.pnlPct + '%';
  pctEl.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
}

// ── Fetch with Timeout ─────────────────────────────────────
async function fetchWithTimeout(resource, options = {}, timeout = 6000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(resource, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}
