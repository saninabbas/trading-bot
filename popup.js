'use strict';
/* ── FUTURES AI – popup.js ─────────────────────────────── */

let selectedStrategy = 'RSI+EMA';
let botRunning = false;

document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  await checkApiKeys();
  initListeners();
  startRefresh();
});

function initListeners() {
  document.getElementById('start-btn').addEventListener('click', toggleBot);
  document.getElementById('full-dashboard-btn').addEventListener('click', openDashboard);
  document.getElementById('premium-badge-btn').addEventListener('click', openDashboard);
  document.getElementById('api-setup-link').addEventListener('click', openDashboard);

  document.querySelectorAll('.strategy-card').forEach(card => {
    card.addEventListener('click', function () {
      selectStrategy(this.dataset.strategy);
    });
  });
}

async function loadState() {
  const d = await chrome.storage.local.get(['botRunning', 'selectedStrategy', 'stats', 'savedSettings']);
  botRunning = !!d.botRunning;
  if (botRunning) setBotUI(true);
  if (d.selectedStrategy) {
    selectedStrategy = d.selectedStrategy;
    highlightStrategy(selectedStrategy);
  }
  if (d.stats) updateStatsUI(d.stats);
  if (d.savedSettings?.leverage) {
    document.getElementById('leverage-display').textContent = (d.savedSettings.leverage || 10) + 'x';
  }

  // Premium badge
  const health = await sendMsg({ action: 'GET_HEALTH' });
  if (health) {
    const badge = document.getElementById('premium-badge-btn');
    if (health.license === 'PRO') {
      badge.textContent = '⭐ PRO';
      badge.className = 'premium-badge';
    } else if (health.license === 'TRIAL') {
      badge.textContent = '⏳ TRIAL';
      badge.className = 'premium-badge trial-badge';
    } else {
      badge.textContent = '🔒 EXPIRED';
      badge.className = 'premium-badge trial-badge';
      badge.style.background = 'linear-gradient(135deg,#ff1744,#c62828)';
    }
  }
}

async function checkApiKeys() {
  const d = await chrome.storage.local.get(['apiKey', 'apiSecret']);
  const bar = document.getElementById('api-status-bar');
  if (d.apiKey && d.apiSecret) {
    bar.className = 'api-status-bar has-api';
    bar.innerHTML = '✅ API Keys configured — Ready to trade';
  }
}

async function toggleBot() {
  const d = await chrome.storage.local.get(['apiKey']);
  if (!d.apiKey) {
    flashBar('⚠️ Please set your API keys in Settings first!', 'no-api');
    return;
  }
  botRunning = !botRunning;
  setBotUI(botRunning);
  await chrome.storage.local.set({ botRunning, selectedStrategy });

  const settingsData = await chrome.storage.local.get('savedSettings');
  const settings = settingsData.savedSettings || {
    symbol: 'BTCUSDT', amount: '50', risk: '2', leverage: '10',
    stopLoss: '1.5', takeProfit: '3', mode: 'paper'
  };

  const resp = await sendMsg({
    action: botRunning ? 'START_BOT' : 'STOP_BOT',
    strategy: selectedStrategy,
    settings
  });

  if (resp && !resp.ok && resp.error) {
    flashBar(`❌ ${resp.error}`, 'no-api');
    botRunning = false;
    setBotUI(false);
    await chrome.storage.local.set({ botRunning: false });
  }
}

function setBotUI(running) {
  const dot    = document.getElementById('status-dot');
  const status = document.getElementById('bot-status');
  const btnTxt = document.getElementById('btn-text');
  const btnIco = document.getElementById('btn-icon');
  const btn    = document.getElementById('start-btn');

  if (running) {
    dot.className    = 'dot dot-on';
    status.textContent = 'BOT RUNNING';
    btnTxt.textContent = 'STOP BOT';
    btnIco.textContent = '⛔';
    btn.classList.add('running');
  } else {
    dot.className    = 'dot dot-off';
    status.textContent = 'BOT OFF';
    btnTxt.textContent = 'START BOT';
    btnIco.textContent = '⚡';
    btn.classList.remove('running');
  }
}

function selectStrategy(strategy) {
  selectedStrategy = strategy;
  highlightStrategy(strategy);
  chrome.storage.local.set({ selectedStrategy });
}

function highlightStrategy(strategy) {
  document.querySelectorAll('.strategy-card').forEach(c => {
    c.classList.toggle('active-strategy', c.dataset.strategy === strategy);
  });
}

function openDashboard() {
  chrome.tabs.create({ url: 'dashboard.html' });
}

function startRefresh() {
  setInterval(async () => {
    const d = await chrome.storage.local.get('stats');
    if (d.stats) updateStatsUI(d.stats);
  }, 4000);
}

function updateStatsUI(stats) {
  if (stats.balance !== undefined) {
    document.getElementById('balance').textContent = parseFloat(stats.balance).toFixed(2) + ' USDT';
  }
  if (stats.dailyPnl !== undefined) {
    const v  = parseFloat(stats.dailyPnl);
    const el = document.getElementById('today-pl');
    el.textContent = (v >= 0 ? '+' : '') + '$' + v.toFixed(2);
    el.className   = v >= 0 ? 'profit' : 'loss';
  }
  if (stats.totalTrades !== undefined) {
    document.getElementById('total-trades').textContent = stats.totalTrades;
    document.getElementById('active-trades').textContent = stats.totalTrades;
  }
  if (stats.winRate !== undefined) {
    document.getElementById('win-rate').textContent = stats.winRate + '%';
  }
}

function flashBar(msg, cls) {
  const bar = document.getElementById('api-status-bar');
  bar.textContent = msg;
  bar.className = `api-status-bar ${cls}`;
  setTimeout(() => checkApiKeys(), 3000);
}

function sendMsg(msg) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(msg, resolve);
    } catch (e) {
      resolve(null);
    }
  });
}
