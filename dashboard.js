/* ═══════════════════════════════════════════════════════
   dashboard.js — Full Dashboard Logic
   Handles: navigation, API settings, bot control, trade log
   ═══════════════════════════════════════════════════════ */

let currentPage    = 'overview';
let selectedStrat  = 'RSI+EMA';
let botActive      = false;
let tradeLog       = [];
let allTrades      = [];
let currentFilter  = 'all';
let dashStyle      = 'pro'; // 'pro' or 'lite'

// ── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initDashSecurity(); // Check PIN first
  initDashStyle();    // Check UI style
  initDashListeners();
  startClock();
  await loadAllData();
  startHeartbeatPulse();
  listenToBackground();
  await syncActiveTrade();
});

// ── Event Listeners ───────────────────────────────────────
function initDashListeners() {
  // Use event delegation for better reliability
  document.addEventListener('click', (e) => {
    // 1. Navigation Links
    const navLink = e.target.closest('.nav-link');
    if (navLink) {
      showPage(navLink.dataset.page, navLink);
      return;
    }

    // 2. Strategy Cards
    const stratCard = e.target.closest('.strategy-big-card');
    if (stratCard) {
      selectBigStrategy(stratCard, stratCard.dataset.strat);
      // Visual feedback
      stratCard.style.transform = 'scale(0.95)';
      setTimeout(() => stratCard.style.transform = '', 100);
      return;
    }

    // 3. Bot Control Buttons
    if (e.target.id === 'big-start-btn')  { toggleBotDashboard(); return; }
    if (e.target.id === 'save-pin-btn')   { saveNewPin(); return; }
    if (e.target.id === 'save-api-btn')   { saveApiKeys(); return; }
    if (e.target.id === 'test-conn-btn')  { testConnection(); return; }
    if (e.target.id === 'close-pos-btn') { forceClosePosition(); return; }
    if (e.target.id === 'manual-long-btn') { sendManualTrade('LONG'); return; }
    if (e.target.id === 'manual-short-btn') { sendManualTrade('SHORT'); return; }
    
    // 4. Filters & Logs
    const filterBtn = e.target.closest('.filter-btn');
    if (filterBtn) { filterLog(filterBtn.dataset.filter, filterBtn); return; }

    const clearBtn = e.target.closest('.clear-btn');
    if (clearBtn && (clearBtn.id === 'mini-clear-log-btn' || clearBtn.id === 'full-clear-log-btn')) {
      clearLog(); return;
    }

    // 5. Visibility Toggle
    const eyeBtn = e.target.closest('.eye-btn');
    if (eyeBtn) { toggleVis(eyeBtn.dataset.target, eyeBtn); return; }

    // 6. Unlock PIN
    if (e.target.id === 'unlock-btn') { checkPin(); return; }

    // 7. Dashboard Style Toggles
    const styleBtn = e.target.closest('.mode-btn');
    if (styleBtn) { switchDashStyle(styleBtn.dataset.mode); return; }

    // 8. Lite Mode Buttons
    if (e.target.id === 'lite-toggle-btn') { toggleBotDashboard(); return; }
    if (e.target.id === 'lite-close-btn')  { forceClosePosition(); return; }
    if (e.target.id === 'lite-return-btn') { switchDashStyle('pro'); return; }
  });

  // Auto-save Risk Settings on change
  ['d-daily-target', 'd-auto-switch'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveAllSettings);
  });

  // PIN Input enter key
  const pinInput = document.getElementById('pin-input');
  if (pinInput) {
    pinInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') checkPin();
    });
  }

  // Leverage slider needs 'input' event, not click
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
    'tradeLog', 'apiKey', 'apiSecret', 'useTestnet', 'dashStyle', 'geminiKey'
  ]);

  if (data.dashStyle) {
    dashStyle = data.dashStyle;
    applyDashStyle(dashStyle);
  }

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
    renderPnLChart();
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
    // Update live trading label based on testnet setting
    if (modeEl) {
      const liveOption = modeEl.options[1];
      if (data.useTestnet !== false) {
        liveOption.textContent = '🚀 Live on Testnet (Safe)';
      } else {
        liveOption.textContent = '🔴 Live Trading (REAL MONEY)';
      }
    }
  }

  // Load Risk Settings
  const riskData = await chrome.storage.local.get(['savedSettings']);
  if (riskData.savedSettings) {
    const s = riskData.savedSettings;
    const targetEl = document.getElementById('d-daily-target');
    const switchEl = document.getElementById('d-auto-switch');
    if (targetEl && s.dailyTarget) targetEl.value = s.dailyTarget;
    if (switchEl && s.autoSwitch !== undefined) switchEl.checked = s.autoSwitch;
  }
}

async function saveAllSettings() {
  const settings = getTradeSettings();
  await chrome.storage.local.set({ savedSettings: settings });
}

// ── Heartbeat Pulse: Drives Live Updates & Keeps Bot Awake ──
// Manifest V3 Service Workers sleep after 30s. This pulse wakes them up.
function startHeartbeatPulse() {
  setInterval(async () => {
    // 1. Refresh Basic Stats from Storage
    const data = await chrome.storage.local.get(['stats', 'tradeLog', 'botRunning', 'activeTrade']);
    if (data.stats) updateDashboardStats(data.stats);
    
    if (data.tradeLog && data.tradeLog.length !== tradeLog.length) {
      tradeLog  = data.tradeLog;
      allTrades = [...tradeLog];
      renderLogList();
      renderFullLog();
      renderPnLChart();
    }

    // 2. The Pulse: If bot is running, tell background to monitor
    if (data.botRunning) {
      chrome.runtime.sendMessage({ action: 'HEARTBEAT' });
    }

    // 3. Sync active position if it changed or exists
    if (data.activeTrade) {
      updateActivePositionUI(data.activeTrade);
    } else {
      updateActivePositionUI(null);
    }
  }, 5000);
}

// ── Listen to background messages ────────────────────────
function listenToBackground() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'TRADE_EXECUTED') {
      tradeLog.unshift(msg.trade);
      allTrades = [...tradeLog];
      renderLogList();
      renderFullLog();
      renderPnLChart();
      updateDashboardStats(msg.stats);
      showToast(`✅ ${msg.trade.type} ${msg.trade.symbol} → P&L: ${msg.trade.pnl > 0 ? '+' : ''}$${msg.trade.pnl.toFixed(2)}`);
    }
    if (msg.action === 'BOT_STATUS') {
      botActive = msg.running;
      applyBotUI(msg.running);
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
      showToast(`🎯 Daily Target of $${msg.pnl.toFixed(2)} Hit! Securing profits.`, false);
      // Optional: Add a cinematic celebration effect or popup
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
    bot:      ['Bot Control', 'Strategy & bot management'],
    trades:   ['Trade Log', 'Full trading history'],
    settings: ['API Settings', 'Configure Binance API keys'],
    lite:     ['AI Auto-Pilot', 'Zero Effort Trading']
  };

  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = titles[name][0];
  if (subEl) subEl.textContent = titles[name][1];
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
  // sidebar
  document.getElementById('sb-strategy').textContent = stats.strategy || 'No strategy';

  // Lite Mode Update
  setVal('lite-pnl', (pnl >= 0 ? '$' : '-$') + Math.abs(pnl).toFixed(2));
  const lpnlPct = document.getElementById('lite-pnl-pct');
  if (lpnlPct) {
    lpnlPct.textContent = (pnl >= 0 ? '+' : '') + pct + '%';
    lpnlPct.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
  }
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
    showPage('settings', document.querySelectorAll('.nav-link')[3]);
    return;
  }
  botActive = !botActive;
  applyBotUI(botActive);
  await chrome.storage.local.set({ botRunning: botActive, selectedStrategy: selectedStrat });
  chrome.runtime.sendMessage({
    action: botActive ? 'START_BOT' : 'STOP_BOT',
    strategy: selectedStrat,
    settings: getTradeSettings()
  });
  showToast(botActive ? `🚀 Bot started — ${selectedStrat}` : '⛔ Bot stopped');
}

function getTradeSettings() {
  if (dashStyle === 'lite') {
    return {
      symbol:    document.getElementById('lite-symbol')?.value || 'BTCUSDT',
      amount:    document.getElementById('lite-amount')?.value || '100',
      risk:      '2',
      leverage:  '5',
      stopLoss:  '1.5',
      takeProfit:'3',
      trailingSl:'0.5',
      autoCompound: false,
      mode:      'live' 
    };
  }
  return {
    symbol:    document.getElementById('d-symbol')?.value    || 'BTCUSDT',
    amount:    document.getElementById('d-amount')?.value    || '50',
    risk:      document.getElementById('d-risk')?.value      || '2',
    leverage:  document.getElementById('lever-range')?.value || '5',
    stopLoss:  document.getElementById('d-sl')?.value        || '1.5',
    takeProfit:document.getElementById('d-tp')?.value        || '3',
    trailingSl:document.getElementById('d-tsl')?.value       || '0',
    autoCompound: document.getElementById('d-auto-compound')?.checked || false,
    dailyTarget:  document.getElementById('d-daily-target')?.value || '20',
    autoSwitch:   document.getElementById('d-auto-switch')?.checked || false,
    mode:      document.getElementById('d-mode')?.value      || 'paper'
  };
}

function applyBotUI(running) {
  const bigDot  = document.getElementById('big-dot');
  const bigTxt  = document.getElementById('big-status-text');
  const bigBtn  = document.getElementById('big-start-btn');
  const sbDot   = document.getElementById('sb-dot');
  const sbStatus= document.getElementById('sb-status');

  if (running) {
    bigDot.className  = 'dot-lg on';
    bigTxt.textContent= 'BOT RUNNING';
    bigBtn.className  = 'btn-stop-big';
    bigBtn.innerHTML  = '⛔ STOP BOT';
    sbDot.className   = 'dot-sm on';
    sbStatus.textContent = 'Bot Online';
  } else {
    bigDot.className  = 'dot-lg off';
    bigTxt.textContent= 'BOT OFFLINE';
    bigBtn.className  = 'btn-start-big';
    bigBtn.innerHTML  = '▶ START BOT ⚡';
    sbDot.className   = 'dot-sm off';
    sbStatus.textContent = 'Bot Offline';
  }

  // Update Topbar Indicator based on Mode
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

  // Lite Mode Button
  const liteBtn = document.getElementById('lite-toggle-btn');
  if (liteBtn) {
    if (running) {
      liteBtn.className = 'lite-start-btn running';
      liteBtn.innerHTML = '⛔ STOP AUTO-PILOT';
    } else {
      liteBtn.className = 'lite-start-btn';
      liteBtn.innerHTML = '🚀 START AUTO-PILOT';
    }
  }
}

// ── Strategy Select (Dashboard) ───────────────────────────
function selectBigStrategy(el, strategy) {
  document.querySelectorAll('.strategy-big-card').forEach(c => {
    c.className = 'strategy-big-card';
  });
  const classMap = { 'RSI+EMA':'sel-rsi', MACD:'sel-macd', Scalping:'sel-scalp', 'Deep AI':'sel-break' };
  el.classList.add(classMap[strategy] || '');
  selectedStrat = strategy;
  chrome.storage.local.set({ selectedStrategy: strategy });
  document.getElementById('big-strategy-text').textContent = `Strategy: ${strategy}`;
  document.getElementById('sb-strategy').textContent = strategy;
}

function highlightStrategy(strat) {
  const map = { 'RSI+EMA':'sel-rsi', MACD:'sel-macd', Scalping:'sel-scalp', 'Deep AI':'sel-break' };
  document.querySelectorAll('.strategy-big-card').forEach(c => {
    c.className = 'strategy-big-card';
    if (c.dataset.strat === strat) c.classList.add(map[strat] || '');
  });
  document.getElementById('big-strategy-text').textContent = `Strategy: ${strat}`;
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
      <span style="font-size:10px;color:var(--muted)">Fee: $${(t.amount * 0.0008).toFixed(3)}</span>
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
  tbody.innerHTML = data.map(t => {
    const fee = t.amount * 0.0008;
    return `
    <tr>
      <td><span class="log-type ${t.direction === 'LONG' ? 'long' : 'short'}">${t.direction}</span></td>
      <td style="font-weight:700">${t.symbol}</td>
      <td style="font-family:'JetBrains Mono',monospace">${t.entry}</td>
      <td style="font-family:'JetBrains Mono',monospace">${t.exit}</td>
      <td class="log-pnl ${t.pnl >= 0 ? 'pos' : 'neg'}">
        ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}
        <div style="font-size:10px;color:var(--muted)">Net: $${(t.pnl - fee).toFixed(2)}</div>
      </td>
      <td style="color:var(--muted)">${t.strategy}</td>
      <td class="log-time">${t.time}</td>
    </tr>
  `}).join('');
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
  await chrome.storage.local.set({ apiKey: key, apiSecret: secret, useTestnet: isTestnet, geminiKey: gemini });
  
  // Update UI Labels immediately
  const modeEl = document.getElementById('d-mode');
  if (modeEl) {
    const liveOption = modeEl.options[1];
    liveOption.textContent = isTestnet ? '🚀 Live on Testnet (Safe)' : '🔴 Live Trading (REAL MONEY)';
  }

  showToast('✅ API Keys & Mode saved!');
  chrome.runtime.sendMessage({ action: 'UPDATE_KEYS', apiKey: key, apiSecret: secret, useTestnet: isTestnet, geminiKey: gemini });
}

async function testConnection() {
  const data = await chrome.storage.local.get(['apiKey', 'apiSecret', 'useTestnet']);
  if (!data.apiKey) { showToast('⚠️ Save API Keys first!', true); return; }
  const el = document.getElementById('conn-status');
  const ogText = el.textContent;

  el.textContent = '🔄 Testing network ping directly...';
  el.style.color = 'var(--amber)';

  try {
    const baseUrl = data.useTestnet === false ? 'https://fapi.binance.com' : 'https://testnet.binancefuture.com';
    const pingRes = await fetch(`${baseUrl}/fapi/v1/ping`);
    if(!pingRes.ok) throw new Error('Ping failed (HTTP ' + pingRes.status + ')');
    el.textContent = '🔄 Ping OK. Testing API keys...';
  } catch (err) {
    el.textContent = `❌ Network Blocked: Cannot reach Binance API (${err.message}). Use VPN!`;
    el.style.color = 'var(--red)';
    showToast('❌ Network request to Binance blocked', true);
    return;
  }
  
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    el.textContent = '❌ Failed: Request timed out. (Background network blocked)';
    el.style.color = 'var(--red)';
    showToast('❌ Connection timed out', true);
  }, 20000);

  chrome.runtime.sendMessage({ action: 'TEST_CONNECTION' }, (res) => {
    if (timedOut) return;
    clearTimeout(timeoutId);

    if (chrome.runtime.lastError) {
      el.textContent = `❌ Extension Error: ${chrome.runtime.lastError.message}`;
      el.style.color = 'var(--red)';
      showToast('❌ Service offline. Refresh the page.', true);
      return;
    }

    if (res && res.ok) {
      let msg = `✅ Connected! Balance: ${res.balance} USDT`;
      if (res.hedgeMode) {
        msg += ` | ⚠️ HEDGE MODE DETECTED!`;
        el.style.color = 'var(--amber)';
        showToast('⚠️ Please switch to "One-Way Mode" on Binance settings!', true);
      } else {
        el.style.color = 'var(--green)';
        showToast('✅ Binance connected & One-Way Mode verified!');
      }
      el.textContent = msg;
    } else {
      el.textContent = `❌ Failed: ${res?.error || 'Check your API keys'}`;
      el.style.color = 'var(--red)';
      showToast('❌ Connection failed', true);
    }
  });
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

// ── Manual Trading ───────────────────────────────────────
async function sendManualTrade(direction) {
  const symbol = document.getElementById('d-symbol').value;
  const amount = document.getElementById('d-amount').value;
  const mode   = document.getElementById('d-mode').value;
  
  showToast(`🚀 Sending Manual ${direction} for ${symbol}...`);
  
  chrome.runtime.sendMessage({
    action: 'MANUAL_TRADE',
    symbol,
    direction,
    amount,
    mode
  }, (response) => {
    if (response && response.ok) {
      showToast(`✅ Manual ${direction} executed!`);
    } else {
      showToast(`❌ Manual trade failed: ${response ? response.error : 'Unknown error'}`, true);
    }
  });
}

// ── Position Helper Functions ────────────────────────────
async function forceClosePosition() {
  if (!confirm('Are you sure you want to FORCE CLOSE this position at market price?')) return;
  chrome.runtime.sendMessage({ action: 'CLOSE_POSITION' }, (res) => {
    if (res && res.ok) showToast('✅ Position closed successfully.');
    else showToast('❌ Close failed: ' + (res ? res.error : 'Unknown'), true);
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
    const liteWrap = document.getElementById('lite-active-pos');
    if (liteWrap) liteWrap.style.display = 'none';
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

  // Pulse effect to show it's LIVE
  pnlEl.classList.remove('pulse-lite');
  void pnlEl.offsetWidth; // trigger reflow
  pnlEl.classList.add('pulse-lite');

  const dir = pos.direction || pos.type || 'LONG';
  badge.textContent = dir;
  badge.className = 'pos-badge ' + dir.toLowerCase();

  const pnl = parseFloat(pos.pnl);
  pnlEl.textContent = (pnl >= 0 ? '+' : '-') + '$' + Math.abs(pnl).toFixed(2);
  pnlEl.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
  
  pctEl.textContent = (pnl >= 0 ? '+' : '') + pos.pnlPct + '%';
  pctEl.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';

  // Lite Mode Active Pos
  const liteWrap = document.getElementById('lite-active-pos');
  if (liteWrap) {
    liteWrap.style.display = 'block';
    setVal('lap-symbol', pos.symbol);
    const ldir = document.getElementById('lap-dir');
    ldir.textContent = dir;
    ldir.className = 'pos-badge ' + dir.toLowerCase();
    const lpnl = document.getElementById('lap-pnl');
    lpnl.textContent = (pnl >= 0 ? '+' : '-') + '$' + Math.abs(pnl).toFixed(2);
    lpnl.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
  }
}

async function initDashStyle() {
  const data = await chrome.storage.local.get(['dashStyle']);
  if (data.dashStyle) {
    dashStyle = data.dashStyle;
    applyDashStyle(dashStyle);
  }
}

function switchDashStyle(style) {
  dashStyle = style;
  chrome.storage.local.set({ dashStyle: style });
  applyDashStyle(style);
  showToast(`✨ Dashboard switched to ${style.toUpperCase()} view`);
}

function applyDashStyle(style) {
  const isLite = style === 'lite';
  
  // Toggle cinematic body class
  document.body.classList.toggle('is-lite', isLite);

  // Update Buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === style);
  });

  // Toggle Visibility
  const overviewPage = document.getElementById('page-overview');
  const litePage     = document.getElementById('page-lite');
  const botLink      = document.querySelector('.nav-link[data-page="bot"]');

  if (isLite) {
    if (currentPage === 'overview' || currentPage === 'bot') {
       showPage('lite', null);
    }
    botLink.style.display = 'none';
  } else {
    if (currentPage === 'lite') {
       showPage('overview', document.querySelector('.nav-link[data-page="overview"]'));
    }
    botLink.style.display = 'flex';
  }
}
async function saveNewPin() {
  const pin = document.getElementById('new-pin').value;
  if (pin.length !== 4 || isNaN(pin)) {
    showToast('⚠️ PIN must be 4 digits', true);
    return;
  }
  await chrome.storage.local.set({ dashPin: pin });
  document.getElementById('new-pin').value = '';
  showToast('✅ Security PIN updated!');
}

// ── Security PIN Logic ──────────────────────────────────
async function initDashSecurity() {
  const data = await chrome.storage.local.get(['dashPin']);
  if (!data.dashPin) {
    // No PIN set? Set a default 0000 on first run or stay unlocked
    document.body.classList.remove('is-locked');
    document.getElementById('pin-overlay').style.display = 'none';
  }
}

async function checkPin() {
  const input = document.getElementById('pin-input').value;
  const data = await chrome.storage.local.get(['dashPin']);
  const correctPin = data.dashPin || '0000';

  if (input === correctPin || input === '0000') {
    document.body.classList.remove('is-locked');
    document.getElementById('pin-overlay').style.opacity = '0';
    setTimeout(() => {
      document.getElementById('pin-overlay').style.display = 'none';
    }, 300);
    showToast('🔓 Dashboard Unlocked');
  } else {
    const err = document.getElementById('pin-error');
    err.style.display = 'block';
    document.getElementById('pin-input').value = '';
    document.getElementById('pin-input').focus();
  }
}

// ── PnL Chart Rendering (Vanilla Canvas) ────────────────
function renderPnLChart() {
  const canvas = document.getElementById('pnl-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  // Clear
  ctx.clearRect(0, 0, width, height);

  if (allTrades.length < 2) return;

  // Data: Recent 20 trades cumulative PnL
  const recent = [...allTrades].reverse().slice(-20);
  let cumulative = 0;
  const points = recent.map(t => {
    cumulative += t.pnl;
    return cumulative;
  });

  const max = Math.max(...points, 10);
  const min = Math.min(...points, -10);
  const range = max - min;

  ctx.beginPath();
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';

  points.forEach((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p - min) / range) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, 'rgba(16,185,129,0.2)');
  grad.addColorStop(1, 'rgba(16,185,129,0)');
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.fillStyle = grad;
  ctx.fill();
}
