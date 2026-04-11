'use strict';
/* ── FUTURES AI – dashboard.js ────────────────────────────── */

/* ── Tab Navigation ─────────────────────────────── */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    const tab = item.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`tab-${tab}`)?.classList.add('active');
  });
});

/* ── Init ────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await loadHealth();
  await loadSettings();
  await loadOverview();
  await loadLicenseStatus();
  await loadTradeHistory();
  initListeners();

  // Live refresh every 5s
  setInterval(async () => {
    await loadOverview();
    await loadHealth();
  }, 5000);

  // Live message listener (from background service worker)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'BOT_STATUS')      updateBotStatus(msg.status);
    if (msg.action === 'POSITION_UPDATE') renderPosition(msg.position);
    if (msg.action === 'ACTION_LOG')      appendLog(msg.text);
  });
});

/* ── Listeners ───────────────────────────────────── */
function initListeners() {
  document.getElementById('save-api-btn').addEventListener('click', saveApiKeys);
  document.getElementById('test-api-btn').addEventListener('click', testConnection);
  document.getElementById('save-settings-btn').addEventListener('click', saveTradeSettings);
  document.getElementById('refresh-btn').addEventListener('click', loadOverview);
  document.getElementById('close-pos-btn').addEventListener('click', closePosition);
  document.getElementById('force-clear-btn').addEventListener('click', forceClear);
  document.getElementById('activate-btn').addEventListener('click', activateLicense);
  document.getElementById('copy-device-btn').addEventListener('click', copyDeviceId);
  document.getElementById('clear-history-btn').addEventListener('click', clearHistory);
}

/* ── System Health ───────────────────────────────── */
async function loadHealth() {
  const h = await sendMsg({ action: 'GET_HEALTH' });
  if (!h) return;

  const apiEl = document.getElementById('h-api');
  apiEl.textContent = h.api ? 'CONNECTED' : 'NOT SET';
  apiEl.className   = `h-val ${h.api ? 'good' : 'bad'}`;

  const modeEl = document.getElementById('h-mode');
  modeEl.textContent = h.mode || '–';
  modeEl.className   = `h-val ${h.mode === 'LIVE' ? 'warn' : ''}`;

  const botEl = document.getElementById('h-bot');
  botEl.textContent = h.running ? 'RUNNING' : 'STOPPED';
  botEl.className   = `h-val ${h.running ? 'good' : 'bad'}`;

  const licEl = document.getElementById('h-license');
  licEl.textContent = h.license || '–';
  licEl.className   = `h-val ${h.license === 'PRO' ? 'good' : h.license === 'TRIAL' ? 'warn' : 'bad'}`;
}

/* ── Overview ────────────────────────────────────── */
async function loadOverview() {
  const d = await chrome.storage.local.get(['stats', 'activeTrade', 'botRunning']);

  if (d.stats) {
    const s = d.stats;
    const pnl = parseFloat(s.dailyPnl || 0);

    document.getElementById('ov-balance').textContent = parseFloat(s.balance || 0).toFixed(2) + ' USDT';
    const pnlEl = document.getElementById('ov-pnl');
    pnlEl.textContent = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
    pnlEl.className   = `metric-value ${pnl >= 0 ? 'green' : 'red'}`;

    document.getElementById('ov-winrate').textContent = (s.winRate || 0) + '%';
    document.getElementById('ov-total').textContent   = s.totalTrades || 0;
  }

  renderPosition(d.activeTrade || null);
  updateBotStatus(d.botRunning ? 'running' : 'stopped');
}

function updateBotStatus(status) {
  const botEl = document.getElementById('h-bot');
  if (botEl) {
    botEl.textContent = status === 'running' ? 'RUNNING' : 'STOPPED';
    botEl.className   = `h-val ${status === 'running' ? 'good' : 'bad'}`;
  }
}

/* ── Position Panel ──────────────────────────────── */
function renderPosition(pos) {
  const panel = document.getElementById('position-panel');
  const closeBtn = document.getElementById('close-pos-btn');

  if (!pos) {
    panel.innerHTML = '<div class="no-trade">No open position</div>';
    closeBtn.style.display = 'none';
    return;
  }

  closeBtn.style.display = 'inline-flex';
  const pnl = pos.pnl || 0;
  const pnlPct = pos.pnlPct || 0;
  const badge = pos.direction === 'LONG' ? 'long-badge' : 'short-badge';
  const pnlCls = pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
  const modeB = pos.mode === 'LIVE' ? 'badge-live' : 'badge-paper';

  panel.innerHTML = `
    <div class="position-grid">
      <div class="pos-item">
        <div class="pos-label">DIRECTION</div>
        <div class="pos-val"><span class="${badge}">${pos.direction}</span></div>
      </div>
      <div class="pos-item">
        <div class="pos-label">SYMBOL</div>
        <div class="pos-val">${pos.symbol}</div>
      </div>
      <div class="pos-item">
        <div class="pos-label">MODE</div>
        <div class="pos-val"><span class="${modeB}">${pos.mode}</span></div>
      </div>
      <div class="pos-item">
        <div class="pos-label">ENTRY PRICE</div>
        <div class="pos-val">$${parseFloat(pos.entry).toFixed(2)}</div>
      </div>
      <div class="pos-item">
        <div class="pos-label">MARK PRICE</div>
        <div class="pos-val">$${parseFloat(pos.markPrice || pos.entry).toFixed(2)}</div>
      </div>
      <div class="pos-item">
        <div class="pos-label">UNREAL P&L</div>
        <div class="pos-val ${pnlCls}">${pnl >= 0 ? '+' : ''}${parseFloat(pnl).toFixed(4)} (${pnlPct >= 0 ? '+' : ''}${parseFloat(pnlPct).toFixed(2)}%)</div>
      </div>
      <div class="pos-item">
        <div class="pos-label">STOP LOSS</div>
        <div class="pos-val" style="color:var(--red)">$${parseFloat(pos.sl).toFixed(2)}</div>
      </div>
      <div class="pos-item">
        <div class="pos-label">TAKE PROFIT</div>
        <div class="pos-val" style="color:var(--green)">$${parseFloat(pos.tp).toFixed(2)}</div>
      </div>
      <div class="pos-item">
        <div class="pos-label">OPENED AT</div>
        <div class="pos-val" style="font-size:12px">${pos.time || '–'}</div>
      </div>
    </div>
  `;
}

async function closePosition() {
  const btn = document.getElementById('close-pos-btn');
  btn.textContent = '⏳ Closing...';
  btn.disabled = true;
  try {
    const r = await sendMsg({ action: 'CLOSE_POSITION' });
    if (r?.ok) showResult('pos', 'Position closed successfully.', 'ok');
    else showResult('pos', r?.error || 'Close failed.', 'err');
  } catch (e) {
    showResult('pos', e.message, 'err');
  }
  btn.textContent = '⛔ Close Position';
  btn.disabled = false;
}

async function forceClear() {
  if (!confirm('Force clear active trade from local state? (No Binance order sent)')) return;
  await sendMsg({ action: 'FORCE_CLEAR' });
  renderPosition(null);
}

/* ── Action Log ──────────────────────────────────── */
function appendLog(text) {
  const box = document.getElementById('action-log');
  if (!box) return;
  if (box.children.length === 1 && box.children[0].classList.contains('muted')) {
    box.innerHTML = '';
  }
  const line = document.createElement('div');
  line.className = 'log-line';
  const cls = text.includes('✅') || text.includes('🟢') ? 'good'
    : text.includes('❌') || text.includes('🛑') ? 'bad' : '';
  if (cls) line.classList.add(cls);
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  box.prepend(line);
  while (box.children.length > 80) box.lastChild.remove();
}

/* ── Settings ────────────────────────────────────── */
async function loadSettings() {
  const d = await chrome.storage.local.get(['apiKey', 'apiSecret', 'useTestnet', 'savedSettings']);
  if (d.apiKey)    document.getElementById('s-api-key').value    = d.apiKey;
  if (d.apiSecret) document.getElementById('s-api-secret').value = d.apiSecret;
  document.getElementById('s-testnet').value = d.useTestnet === false ? 'false' : 'true';

  const s = d.savedSettings || {};
  if (s.symbol)   document.getElementById('s-symbol').value   = s.symbol;
  if (s.leverage) document.getElementById('s-leverage').value = s.leverage;
  if (s.risk)     document.getElementById('s-risk').value     = s.risk;
  if (s.stopLoss) document.getElementById('s-sl').value       = s.stopLoss;
  if (s.takeProfit) document.getElementById('s-tp').value     = s.takeProfit;
  if (s.amount)   document.getElementById('s-amount').value   = s.amount;
  if (s.mode)     document.getElementById('s-mode').value     = s.mode;
}

async function saveApiKeys() {
  const apiKey    = document.getElementById('s-api-key').value.trim();
  const apiSecret = document.getElementById('s-api-secret').value.trim();
  const useTestnet = document.getElementById('s-testnet').value !== 'false';

  if (!apiKey || !apiSecret) {
    showResult('api', '❌ Both fields are required.', 'err'); return;
  }

  await chrome.storage.local.set({ apiKey, apiSecret, useTestnet });
  await sendMsg({ action: 'UPDATE_KEYS', apiKey, apiSecret, useTestnet });
  showResult('api', '✅ API Keys saved!', 'ok');
}

async function testConnection() {
  showResult('api', '⏳ Testing...', '');
  try {
    const r = await sendMsg({ action: 'TEST_CONNECTION' });
    if (r?.ok) showResult('api', `✅ Connected! Balance: ${r.balance} USDT`, 'ok');
    else       showResult('api', `❌ ${r?.error || 'Connection failed'}`, 'err');
  } catch (e) {
    showResult('api', `❌ Error: ${e.message}`, 'err');
  }
}

async function saveTradeSettings() {
  const settings = {
    symbol:     (document.getElementById('s-symbol').value || 'BTCUSDT').toUpperCase(),
    leverage:   parseInt(document.getElementById('s-leverage').value || 10),
    risk:       Math.min(parseFloat(document.getElementById('s-risk').value || 2), 2),
    stopLoss:   parseFloat(document.getElementById('s-sl').value || 1.5),
    takeProfit: parseFloat(document.getElementById('s-tp').value || 3),
    amount:     parseFloat(document.getElementById('s-amount').value || 50),
    mode:       document.getElementById('s-mode').value || 'paper'
  };
  await chrome.storage.local.set({ savedSettings: settings });
  showResult('settings', '✅ Settings saved!', 'ok');
}

function showResult(area, msg, type) {
  const ids = { api: 'api-result', settings: 'settings-result', pos: 'api-result', license: 'license-result' };
  const el = document.getElementById(ids[area]);
  if (!el) return;
  el.textContent  = msg;
  el.className    = `result-msg ${type === 'ok' ? 'ok' : type === 'err' ? 'err' : ''}`;
}

/* ── Trade History ────────────────────────────────── */
async function loadTradeHistory() {
  const d = await chrome.storage.local.get('tradeHistory');
  const history = d.tradeHistory || [];
  const tbody   = document.getElementById('history-body');

  if (!history.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="no-data">No trades yet.</td></tr>';
    return;
  }

  tbody.innerHTML = history.map(t => {
    const pnlNum = parseFloat(t.pnl);
    const pnlCls = pnlNum >= 0 ? 'pnl-pos' : 'pnl-neg';
    const pnlStr = (pnlNum >= 0 ? '+' : '') + pnlNum.toFixed(4);
    const modeBadge = t.mode === 'LIVE' ? 'badge-live' : 'badge-paper';
    const time = t.closedAt ? new Date(t.closedAt).toLocaleString() : '–';
    return `<tr>
      <td>${t.symbol}</td>
      <td>${t.direction}</td>
      <td>$${parseFloat(t.entry).toFixed(2)}</td>
      <td>$${parseFloat(t.exit).toFixed(2)}</td>
      <td class="${pnlCls}">${pnlStr}</td>
      <td>${t.reason}</td>
      <td><span class="${modeBadge}">${t.mode}</span></td>
      <td style="font-size:11px;color:var(--muted)">${time}</td>
    </tr>`;
  }).join('');
}

async function clearHistory() {
  if (!confirm('Clear all trade history?')) return;
  await chrome.storage.local.remove('tradeHistory');
  document.getElementById('history-body').innerHTML =
    '<tr><td colspan="8" class="no-data">No trades yet.</td></tr>';
}

/* ── License ──────────────────────────────────────── */
async function loadLicenseStatus() {
  const d = await chrome.storage.local.get(['deviceId', 'licenseKey', 'activationDate', 'installTime']);
  document.getElementById('device-id-text').textContent = d.deviceId || 'Generating...';

  if (d.licenseKey) {
    document.getElementById('license-key-input').value = d.licenseKey;
  }

  const now = Date.now();
  if (d.licenseKey && d.activationDate) {
    const elapsed   = now - d.activationDate;
    const remaining = 2592000000 - elapsed;
    const daysLeft  = Math.max(0, Math.ceil(remaining / 86400000));
    document.getElementById('ls-status').textContent    = daysLeft > 0 ? '✅ ACTIVE PRO' : '❌ EXPIRED';
    document.getElementById('ls-status').style.color    = daysLeft > 0 ? 'var(--green)' : 'var(--red)';
    document.getElementById('ls-activated').textContent = new Date(d.activationDate).toLocaleDateString();
    document.getElementById('ls-expiry').textContent    = new Date(d.activationDate + 2592000000).toLocaleDateString();
    document.getElementById('ls-days').textContent      = daysLeft > 0 ? `${daysLeft} days` : 'Expired';
  } else if (d.installTime) {
    const trialLeft = 3600000 - (now - d.installTime);
    const minsLeft  = Math.max(0, Math.ceil(trialLeft / 60000));
    document.getElementById('ls-status').textContent    = minsLeft > 0 ? '⏳ FREE TRIAL' : '❌ TRIAL EXPIRED';
    document.getElementById('ls-status').style.color    = minsLeft > 0 ? 'var(--amber)' : 'var(--red)';
    document.getElementById('ls-activated').textContent = 'Trial';
    document.getElementById('ls-expiry').textContent    = minsLeft > 0 ? 'Active' : 'Expired';
    document.getElementById('ls-days').textContent      = minsLeft > 0 ? `${minsLeft} min remaining` : 'Expired';
  }
}

async function activateLicense() {
  const key = document.getElementById('license-key-input').value.trim().toUpperCase();
  if (!key.startsWith('FUTURES-AI-PRO-')) {
    showResult('license', '❌ Invalid format. Must start with FUTURES-AI-PRO-', 'err'); return;
  }

  const r = await sendMsg({ action: 'VALIDATE_KEY', key });
  if (r?.valid) {
    await chrome.storage.local.set({ licenseKey: key, activationDate: Date.now() });
    showResult('license', '🚀 License Activated! 30 days of PRO access granted.', 'ok');
    await loadLicenseStatus();
  } else {
    showResult('license', '❌ Invalid key for this device. Please contact support.', 'err');
  }
}

async function copyDeviceId() {
  const id = document.getElementById('device-id-text').textContent;
  await navigator.clipboard.writeText(id).catch(() => {});
  const btn = document.getElementById('copy-device-btn');
  btn.textContent = '✅ Copied!';
  setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
}

/* ── Utility ─────────────────────────────────────── */
function sendMsg(msg) {
  return new Promise(resolve => {
    try { chrome.runtime.sendMessage(msg, resolve); }
    catch (e) { resolve(null); }
  });
}
