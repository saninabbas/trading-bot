/* ═══════════════════════════════════════════════════════
   popup.js — AI Futures Bot Popup Logic
   Handles: bot toggle, strategy select, balance display
   ═══════════════════════════════════════════════════════ */

let selectedStrategy = "RSI+EMA";
let botRunning = false;

// ── On Load ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  await checkApiKeys();
  startBalanceRefresh();
  initListeners();
});

// ── Event Listeners ───────────────────────────────────────
function initListeners() {
  // Start/Stop Toggle
  const startBtn = document.getElementById('start-btn');
  if (startBtn) startBtn.addEventListener('click', toggleBot);

  // Full Dashboard Links
  const fullDashBtn = document.getElementById('full-dashboard-btn');
  if (fullDashBtn) fullDashBtn.addEventListener('click', openFullDashboard);

  const premBtn = document.getElementById('premium-badge-btn');
  if (premBtn) premBtn.addEventListener('click', openFullDashboard);

  const setupLink = document.getElementById('api-setup-link');
  if (setupLink) setupLink.addEventListener('click', openFullDashboard);

  // Strategy Selection
  document.querySelectorAll('.strategy-card').forEach(card => {
    card.addEventListener('click', function() {
      selectStrategy(this, this.dataset.strategy);
    });
  });
}

// ── Load saved state from Chrome storage ─────────────────
async function loadState() {
  try {
    const data = await chrome.storage.local.get([
      'botRunning', 'selectedStrategy', 'stats', 'settings'
    ]);

    if (data.botRunning) {
      botRunning = true;
      setBotUI(true);
    }

    if (data.selectedStrategy) {
      selectedStrategy = data.selectedStrategy;
      document.querySelectorAll('.strategy-card').forEach(c => {
        c.classList.remove('active-strategy');
        if (c.dataset.strategy === selectedStrategy) c.classList.add('active-strategy');
      });
    }

    if (data.stats) {
      updateStatsUI(data.stats);
    }
  } catch (e) {
    console.log('Storage read:', e);
  }
}

// ── Check if API keys are configured ─────────────────────
async function checkApiKeys() {
  try {
    const data = await chrome.storage.local.get(['apiKey', 'apiSecret']);
    const bar = document.getElementById('api-status-bar');
    if (data.apiKey && data.apiSecret) {
      bar.className = 'api-status-bar has-api';
      bar.innerHTML = '✅ API Keys configured — Ready to trade';
    }
  } catch (e) {}
}

// ── Toggle Bot ON / OFF ───────────────────────────────────
async function toggleBot() {
  try {
    const data = await chrome.storage.local.get(['apiKey']);
    if (!data.apiKey) {
      showAlert('⚠️ Please configure your API keys first!', 'warning');
      return;
    }
  } catch (e) {}

  botRunning = !botRunning;
  setBotUI(botRunning);

  // Save state & notify background worker
  await chrome.storage.local.set({ botRunning, selectedStrategy });
  chrome.runtime.sendMessage({
    action: botRunning ? 'START_BOT' : 'STOP_BOT',
    strategy: selectedStrategy
  });
}

// ── Update popup UI for bot state ────────────────────────
function setBotUI(running) {
  const dot    = document.getElementById('status-dot');
  const status = document.getElementById('bot-status');
  const btnTxt = document.getElementById('btn-text');
  const startBtn = document.getElementById('start-btn');

  if (running) {
    dot.className    = 'dot dot-on';
    status.textContent = 'BOT RUNNING';
    btnTxt.textContent = 'STOP BOT';
    startBtn.classList.add('running');
    startBtn.innerHTML = '<span id="btn-text">STOP BOT</span><span>⛔</span>';
  } else {
    dot.className    = 'dot dot-off';
    status.textContent = 'BOT OFF';
    startBtn.classList.remove('running');
    startBtn.innerHTML = '<span id="btn-text">START BOT</span><span>⚡</span>';
  }
}

// ── Strategy Selector ─────────────────────────────────────
function selectStrategy(el, strategy) {
  document.querySelectorAll('.strategy-card').forEach(c => c.classList.remove('active-strategy'));
  el.classList.add('active-strategy');
  selectedStrategy = strategy;
  chrome.storage.local.set({ selectedStrategy });
}

// ── Open full-screen dashboard ───────────────────────────
function openFullDashboard() {
  chrome.tabs.create({ url: 'dashboard.html' });
}

// ── Refresh balance from storage ─────────────────────────
async function startBalanceRefresh() {
  await refreshBalance();
  setInterval(refreshBalance, 5000);
}

async function refreshBalance() {
  try {
    const data = await chrome.storage.local.get(['stats']);
    if (data.stats) updateStatsUI(data.stats);
  } catch (e) {}
}

// ── Update stats display ──────────────────────────────────
function updateStatsUI(stats) {
  if (stats.balance !== undefined) {
    document.getElementById('balance').textContent = `${parseFloat(stats.balance).toFixed(2)} USDT`;
  }
  if (stats.todayPnl !== undefined) {
    const el = document.getElementById('today-pl');
    const v = parseFloat(stats.todayPnl);
    el.textContent = (v >= 0 ? '+' : '') + '$' + v.toFixed(2);
    el.style.color = v >= 0 ? 'var(--green)' : 'var(--red)';
  }
  if (stats.activeTrades !== undefined) {
    document.getElementById('active-trades').textContent = stats.activeTrades;
  }
  if (stats.winRate !== undefined) {
    document.getElementById('win-rate').textContent = stats.winRate + '%';
  }
  if (stats.totalTrades !== undefined) {
    document.getElementById('total-trades').textContent = stats.totalTrades;
  }
  if (stats.leverage !== undefined) {
    document.getElementById('leverage-display').textContent = stats.leverage + 'x';
  }
}

// ── Simple alert ─────────────────────────────────────────
function showAlert(msg, type = 'info') {
  const el = document.getElementById('api-status-bar');
  el.textContent = msg;
  el.className = `api-status-bar ${type === 'warning' ? 'no-api' : 'has-api'}`;
  setTimeout(() => checkApiKeys(), 3000);
}
