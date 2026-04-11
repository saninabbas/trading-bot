'use strict';
/* ═══════════════════════════════════════════════════════════════
   FUTURES AI – background.js  v2.0 (Clean Engine)
   4 Strategies: RSI+EMA | MACD | Scalping (EMA9/21) | Breakout
   Risk: Max 2% per trade | SL/TP | Daily loss limit
   Modes: Paper (default) | Live Binance Futures
═══════════════════════════════════════════════════════════════ */

/* ── Global State ─────────────────────────────────────────── */
let BOT_RUNNING      = false;
let STRATEGY         = 'RSI+EMA';
let API_KEY          = '';
let API_SECRET       = '';
let USE_TESTNET      = true;
let TRADE_SETTINGS   = {};
let ACTIVE_TRADE     = null;
let SYMBOL_RULES     = {};
let TIME_OFFSET      = 0;
let IS_PROCESSING    = false;
let INSTALL_TIME     = 0;
let DEVICE_ID        = '';
let LICENSE_KEY      = '';
let LICENSE_VALID    = false;
let DAILY_PNL        = 0;
let DAILY_RESET_DATE = '';
let LAST_LOSS_TIME   = 0;

const LIVE_BASE          = 'https://fapi.binance.com';
const TEST_BASE          = 'https://testnet.binancefuture.com';
const BASE_URL           = () => USE_TESTNET ? TEST_BASE : LIVE_BASE;
const TRIAL_DURATION     = 3600000;      // 1 hour
const LICENSE_DURATION   = 2592000000;   // 30 days
const APP_SECRET         = 'FUTURES-AI-V2-SECURE';
const MAX_DAILY_LOSS_PCT = 5;            // Auto-stop if daily loss > 5%
const COOLDOWN_MS        = 15 * 60000;   // 15 min cooldown after loss

/* ── Initialization on every Service Worker wake-up ───────── */
(async () => {
  const d = await chrome.storage.local.get([
    'botRunning', 'selectedStrategy', 'savedSettings',
    'apiKey', 'apiSecret', 'useTestnet', 'activeTrade',
    'installTime', 'deviceId', 'licenseKey', 'dailyPnl', 'dailyResetDate'
  ]);

  // Install time
  if (!d.installTime) {
    INSTALL_TIME = Date.now();
    await chrome.storage.local.set({ installTime: INSTALL_TIME });
  } else {
    INSTALL_TIME = d.installTime;
  }

  // Device ID
  if (!d.deviceId) {
    DEVICE_ID = genDeviceId();
    await chrome.storage.local.set({ deviceId: DEVICE_ID });
  } else {
    DEVICE_ID = d.deviceId;
  }

  API_KEY      = (d.apiKey || '').trim();
  API_SECRET   = (d.apiSecret || '').trim();
  USE_TESTNET  = d.useTestnet !== false;
  LICENSE_KEY  = (d.licenseKey || '').trim();
  LICENSE_VALID = await validateLicenseKey(LICENSE_KEY);
  STRATEGY     = d.selectedStrategy || 'RSI+EMA';
  TRADE_SETTINGS = d.savedSettings || {};
  ACTIVE_TRADE = d.activeTrade || null;
  DAILY_PNL    = d.dailyPnl || 0;
  DAILY_RESET_DATE = d.dailyResetDate || '';

  if (d.botRunning) {
    BOT_RUNNING = true;
    await syncTime();
    chrome.alarms.create('bot-tick', { periodInMinutes: 1 });
  }
})();

/* ── Master Message Handler ───────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Sync handlers (instant)
  if (msg.action === 'GET_HEALTH') {
    sendResponse({
      api:     !!(API_KEY && API_SECRET),
      mode:    USE_TESTNET ? 'TESTNET' : 'LIVE',
      running: BOT_RUNNING,
      license: LICENSE_VALID ? 'PRO' : (isTrialActive() ? 'TRIAL' : 'EXPIRED'),
      deviceId: DEVICE_ID
    });
    return false;
  }

  // Async handlers
  (async () => {
    try {
      // Reload keys for every important action
      if (['START_BOT','FORCE_TRADE','CLOSE_POSITION','FORCE_CLEAR'].includes(msg.action)) {
        await reloadKeys();
        if (!isSubscriptionActive()) {
          sendResponse({ ok: false, error: 'Subscription expired. Please activate your license.' });
          return;
        }
      }

      switch (msg.action) {

        case 'VALIDATE_KEY': {
          const valid = await validateLicenseKey(msg.key);
          sendResponse({ valid });
          break;
        }

        case 'START_BOT': {
          STRATEGY       = msg.strategy || STRATEGY;
          TRADE_SETTINGS = msg.settings || TRADE_SETTINGS;
          const ok = await startBot();
          sendResponse({ ok });
          break;
        }

        case 'STOP_BOT': {
          stopBot();
          sendResponse({ ok: true });
          break;
        }

        case 'UPDATE_KEYS': {
          API_KEY     = (msg.apiKey || '').trim();
          API_SECRET  = (msg.apiSecret || '').trim();
          USE_TESTNET = msg.useTestnet !== false;
          sendResponse({ ok: true });
          break;
        }

        case 'TEST_CONNECTION': {
          await reloadKeys();
          const bal = await getBalance();
          sendResponse({ ok: true, balance: bal });
          break;
        }

        case 'FORCE_TRADE': {
          const sym   = msg.symbol || 'BTCUSDT';
          const dir   = msg.direction || 'LONG';
          const price = await getTickerPrice(sym);
          await openTrade(sym, dir, price);
          sendResponse({ ok: true });
          break;
        }

        case 'CLOSE_POSITION': {
          if (!ACTIVE_TRADE) throw new Error('No active trade');
          const cp = await getTickerPrice(ACTIVE_TRADE.symbol);
          await closeTrade(cp, 'MANUAL');
          sendResponse({ ok: true });
          break;
        }

        case 'FORCE_CLEAR': {
          ACTIVE_TRADE = null;
          await chrome.storage.local.remove('activeTrade');
          broadcastPosition(null);
          sendResponse({ ok: true });
          break;
        }

        case 'GET_BALANCE': {
          await reloadKeys();
          const b = await getBalance();
          sendResponse({ balance: b });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'Unknown action' });
      }
    } catch (e) {
      log('Message Error', e.message);
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

/* ── Bot Start / Stop ─────────────────────────────────────── */
async function startBot() {
  if (!API_KEY || !API_SECRET) throw new Error('API Keys not configured');
  BOT_RUNNING = true;
  await chrome.storage.local.set({ botRunning: true, selectedStrategy: STRATEGY });
  await syncTime();
  chrome.alarms.create('bot-tick', { periodInMinutes: 1 });
  broadcastStatus('running');
  log('🟢 Bot STARTED', STRATEGY);
  return true;
}

function stopBot() {
  BOT_RUNNING = false;
  chrome.storage.local.set({ botRunning: false });
  chrome.alarms.clear('bot-tick');
  broadcastStatus('stopped');
  log('🔴 Bot STOPPED');
}

/* ── Alarm: Bot Tick (every 1 min) ───────────────────────── */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'bot-tick') return;
  if (!BOT_RUNNING || IS_PROCESSING) return;

  IS_PROCESSING = true;
  try {
    // Reload keys fresh each tick
    const d = await chrome.storage.local.get([
      'apiKey','apiSecret','useTestnet','savedSettings','selectedStrategy','activeTrade','dailyPnl','dailyResetDate'
    ]);
    API_KEY        = (d.apiKey || '').trim();
    API_SECRET     = (d.apiSecret || '').trim();
    USE_TESTNET    = d.useTestnet !== false;
    TRADE_SETTINGS = d.savedSettings || TRADE_SETTINGS;
    STRATEGY       = d.selectedStrategy || STRATEGY;
    ACTIVE_TRADE   = d.activeTrade || null;
    DAILY_PNL      = d.dailyPnl    || 0;
    DAILY_RESET_DATE = d.dailyResetDate || '';

    // Reset daily PnL tracker at midnight
    const today = new Date().toDateString();
    if (DAILY_RESET_DATE !== today) {
      DAILY_PNL = 0;
      DAILY_RESET_DATE = today;
      await chrome.storage.local.set({ dailyPnl: 0, dailyResetDate: today });
    }

    // Monitor open trade
    if (ACTIVE_TRADE) {
      await monitorTrade();
    } else {
      // Check cooldown after loss
      const cooldownLeft = COOLDOWN_MS - (Date.now() - LAST_LOSS_TIME);
      if (LAST_LOSS_TIME > 0 && cooldownLeft > 0) {
        log(`⏳ Cooldown: ${Math.ceil(cooldownLeft / 60000)}min left`);
      } else {
        await runStrategy();
      }
    }

    // Sync balance to storage
    try {
      const bal = await getBalance();
      const statsData = await chrome.storage.local.get('stats');
      const stats = statsData.stats || {};
      stats.balance = parseFloat(bal);
      stats.dailyPnl = DAILY_PNL;
      await chrome.storage.local.set({ stats });
    } catch(e) { /* balance sync is non-critical */ }

  } catch (e) {
    log('Tick error', e.message);
  } finally {
    IS_PROCESSING = false;
  }
});

/* ══════════════════════════════════════════════════════════
   STRATEGY ENGINE
══════════════════════════════════════════════════════════ */
async function runStrategy() {
  const symbol = (TRADE_SETTINGS.symbol || 'BTCUSDT').toUpperCase();
  log(`🔍 Scanning [${STRATEGY}] on ${symbol}...`);
  broadcastLog(`🔍 Scanning [${STRATEGY}] on ${symbol}...`);

  // Check daily loss limit
  const bal = await getBalance();
  const maxLoss = parseFloat(bal) * (MAX_DAILY_LOSS_PCT / 100);
  if (DAILY_PNL < 0 && Math.abs(DAILY_PNL) >= maxLoss) {
    broadcastLog('🛑 Daily loss limit hit. Bot paused for today.');
    stopBot();
    return;
  }

  try {
    const candles = await getCandles(symbol, '15m', 100);
    if (!candles || candles.length < 50) { log('Not enough candles'); return; }

    const closes  = candles.map(c => parseFloat(c[4]));
    const highs   = candles.map(c => parseFloat(c[2]));
    const lows    = candles.map(c => parseFloat(c[3]));
    const price   = closes[closes.length - 1];

    let direction = null;

    switch (STRATEGY) {
      case 'RSI+EMA':   direction = signalRsiEma(closes, price);    break;
      case 'MACD':      direction = signalMacd(closes);             break;
      case 'Scalping':  direction = signalScalping(closes);         break;
      case 'Breakout':  direction = signalBreakout(closes, highs, lows, price); break;
    }

    if (direction) {
      log(`✅ Signal: ${direction} on ${symbol} @ $${price.toFixed(2)}`);
      broadcastLog(`✅ Signal: ${direction} | ${symbol} @ $${price.toFixed(2)}`);
      await openTrade(symbol, direction, price);
    } else {
      broadcastLog(`⏳ No signal yet (${STRATEGY})`);
    }
  } catch (e) {
    log('Strategy error', e.message);
    broadcastLog(`⚠️ Strategy error: ${e.message}`);
  }
}

/* ── Strategy 1: RSI + EMA ──────────────────────────────── */
function signalRsiEma(closes, price) {
  const rsiArr = calcRSI(closes, 14);
  const ema50  = calcEMA(closes, 50);
  if (!rsiArr || !ema50) return null;

  const rsi = rsiArr[rsiArr.length - 1];
  const ema = ema50[ema50.length - 1];

  if (rsi < 35 && price > ema) return 'LONG';
  if (rsi > 65 && price < ema) return 'SHORT';
  return null;
}

/* ── Strategy 2: MACD ───────────────────────────────────── */
function signalMacd(closes) {
  const macdLine   = zipSub(calcEMA(closes, 12), calcEMA(closes, 26));
  if (!macdLine || macdLine.length < 10) return null;
  const signal     = calcEMAFromArr(macdLine, 9);
  if (!signal || signal.length < 2) return null;

  const i = signal.length - 1;
  const prevMacd = macdLine[macdLine.length - 2];
  const currMacd = macdLine[macdLine.length - 1];
  const prevSig  = signal[i - 1];
  const currSig  = signal[i];

  // Bullish crossover
  if (prevMacd < prevSig && currMacd > currSig && currMacd < 0) return 'LONG';
  // Bearish crossover
  if (prevMacd > prevSig && currMacd < currSig && currMacd > 0) return 'SHORT';
  return null;
}

/* ── Strategy 3: Scalping EMA 9/21 ─────────────────────── */
function signalScalping(closes) {
  const ema9  = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  if (!ema9 || !ema21 || ema9.length < 3) return null;

  const prev9  = ema9[ema9.length - 2];
  const curr9  = ema9[ema9.length - 1];
  const prev21 = ema21[ema21.length - 2];
  const curr21 = ema21[ema21.length - 1];

  // EMA 9 crosses ABOVE EMA 21
  if (prev9 < prev21 && curr9 > curr21) return 'LONG';
  // EMA 9 crosses BELOW EMA 21
  if (prev9 > prev21 && curr9 < curr21) return 'SHORT';
  return null;
}

/* ── Strategy 4: Breakout ───────────────────────────────── */
function signalBreakout(closes, highs, lows, price) {
  const period = 20;
  if (closes.length < period + 2) return null;

  const recentHighs = highs.slice(-period - 1, -1);
  const recentLows  = lows.slice(-period - 1, -1);
  const prevHigh    = Math.max(...recentHighs);
  const prevLow     = Math.min(...recentLows);

  // Candle must close clearly outside the range
  const margin = (prevHigh - prevLow) * 0.005; // 0.5% buffer
  if (price > prevHigh + margin) return 'LONG';
  if (price < prevLow  - margin) return 'SHORT';
  return null;
}

/* ══════════════════════════════════════════════════════════
   TRADE EXECUTION
══════════════════════════════════════════════════════════ */
async function openTrade(symbol, direction, currentPrice) {
  if (ACTIVE_TRADE) { log('Trade already open, skipping'); return; }

  const s   = TRADE_SETTINGS;
  const bal = await getBalance();
  const leverage  = parseInt(s.leverage  || 10);
  const slPct     = parseFloat(s.stopLoss  || 1.5) / 100;
  const tpPct     = parseFloat(s.takeProfit|| 3.0) / 100;
  const riskPct   = Math.min(parseFloat(s.risk || 2), 2) / 100; // Hard cap at 2%
  const mode      = s.mode || 'paper';

  const accountBalance = parseFloat(bal) || 100;
  const riskAmount     = accountBalance * riskPct;
  const slDistance     = currentPrice * slPct;
  const rawQty         = (riskAmount * leverage) / currentPrice;

  let sl, tp;
  if (direction === 'LONG') {
    sl = currentPrice * (1 - slPct);
    tp = currentPrice * (1 + tpPct);
  } else {
    sl = currentPrice * (1 + slPct);
    tp = currentPrice * (1 - tpPct);
  }

  // Place real order on Binance if Live mode
  let realOrderOk = false;
  if (mode === 'live' && API_KEY && API_SECRET) {
    try {
      await refreshSymbolRules(symbol);
      const qty = formatQty(symbol, rawQty);
      await setLeverage(symbol, leverage);
      await placeMarketOrder(symbol, direction, qty);
      realOrderOk = true;
    } catch (e) {
      log('❌ Live order failed', e.message);
      broadcastLog(`❌ Live order failed: ${e.message}`);
      return; // Don't log a paper trade if live failed
    }
  }

  const qty = formatQty(symbol, rawQty) || rawQty.toFixed(4);

  ACTIVE_TRADE = {
    symbol, direction, entry: currentPrice,
    sl, tp, qty, leverage,
    mode: realOrderOk ? 'LIVE' : 'PAPER',
    openedAt: Date.now(),
    time: new Date().toLocaleTimeString(),
    pnl: 0, pnlPct: 0
  };

  await chrome.storage.local.set({ activeTrade: ACTIVE_TRADE });
  broadcastPosition(ACTIVE_TRADE);
  notify(`🚀 ${direction} Opened`, `${symbol} @ $${currentPrice.toFixed(2)} [${ACTIVE_TRADE.mode}]`);
  log(`🚀 ${direction} ${ACTIVE_TRADE.mode}`, `${symbol} @ ${currentPrice}`);
}

/* ── Monitor Active Trade ─────────────────────────────────── */
async function monitorTrade() {
  if (!ACTIVE_TRADE) return;
  const t = ACTIVE_TRADE;

  let price;
  try {
    price = await getTickerPrice(t.symbol);
  } catch (e) {
    log('Price fetch failed in monitor', e.message);
    return;
  }

  // Update PnL
  const pnlPct = t.direction === 'LONG'
    ? (price - t.entry) / t.entry
    : (t.entry - price) / t.entry;
  const pnl = pnlPct * t.qty * t.entry;
  ACTIVE_TRADE.pnl    = pnl;
  ACTIVE_TRADE.pnlPct = pnlPct * 100;
  ACTIVE_TRADE.markPrice = price;

  await chrome.storage.local.set({ activeTrade: ACTIVE_TRADE });
  broadcastPosition(ACTIVE_TRADE);

  // Check SL/TP
  const hitSL = t.direction === 'LONG' ? price <= t.sl : price >= t.sl;
  const hitTP = t.direction === 'LONG' ? price >= t.tp : price <= t.tp;

  if (hitSL) {
    broadcastLog(`🛑 Stop Loss hit on ${t.symbol}`);
    await closeTrade(price, 'SL');
  } else if (hitTP) {
    broadcastLog(`🎯 Take Profit hit on ${t.symbol}`);
    await closeTrade(price, 'TP');
  }

  // Max trade duration: 4 hours
  if (Date.now() - t.openedAt > 4 * 3600000) {
    broadcastLog(`⏰ Max duration hit. Closing ${t.symbol}`);
    await closeTrade(price, 'MAX_DURATION');
  }
}

/* ── Close Trade ──────────────────────────────────────────── */
async function closeTrade(exitPrice, reason) {
  if (!ACTIVE_TRADE) return;
  const t = ACTIVE_TRADE;

  if (t.mode === 'LIVE' && API_KEY && API_SECRET) {
    try {
      const reverseDir = t.direction === 'LONG' ? 'SHORT' : 'LONG';
      await placeMarketOrder(t.symbol, reverseDir, t.qty);
      log('✅ Live close order sent');
    } catch (e) {
      log('❌ Close order failed', e.message);
      broadcastLog(`❌ Close failed: ${e.message}`);
      throw e;
    }
  }

  const pnlPct = t.direction === 'LONG'
    ? (exitPrice - t.entry) / t.entry
    : (t.entry - exitPrice) / t.entry;
  const pnl = pnlPct * t.qty * t.entry;

  // Update daily PnL
  DAILY_PNL += pnl;
  if (pnl < 0) LAST_LOSS_TIME = Date.now();

  // Save to trade history
  const hist = await chrome.storage.local.get('tradeHistory');
  const history = hist.tradeHistory || [];
  history.unshift({
    symbol: t.symbol, direction: t.direction,
    entry: t.entry, exit: exitPrice,
    pnl: pnl.toFixed(4), pnlPct: (pnlPct * 100).toFixed(2),
    reason, mode: t.mode,
    openedAt: t.openedAt, closedAt: Date.now()
  });
  if (history.length > 100) history.length = 100;

  // Update stats
  const statsData = await chrome.storage.local.get('stats');
  const stats = statsData.stats || { wins: 0, losses: 0, totalPnl: 0 };
  if (pnl >= 0) stats.wins++; else stats.losses++;
  stats.totalPnl  = (parseFloat(stats.totalPnl) || 0) + pnl;
  stats.winRate   = stats.wins + stats.losses > 0
    ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100) : 0;
  stats.totalTrades = (stats.wins || 0) + (stats.losses || 0);
  stats.dailyPnl  = DAILY_PNL;

  ACTIVE_TRADE = null;
  await chrome.storage.local.set({
    activeTrade: null, tradeHistory: history,
    stats, dailyPnl: DAILY_PNL, dailyResetDate: DAILY_RESET_DATE
  });

  broadcastPosition(null);
  notify(`${pnl >= 0 ? '✅' : '❌'} Trade Closed (${reason})`,
    `${t.symbol} | PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
  log(`Closed ${t.symbol} (${reason})`, `PnL: ${pnl.toFixed(2)}`);
}

/* ══════════════════════════════════════════════════════════
   BINANCE API HELPERS
══════════════════════════════════════════════════════════ */
async function getBalance() {
  if (!API_KEY || !API_SECRET) return '0';
  const path   = '/fapi/v2/balance';
  const params = `timestamp=${Date.now() + TIME_OFFSET}`;
  const sig    = await sign(params);
  const res    = await fetchWT(`${BASE_URL()}${path}?${params}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': API_KEY }
  });
  const json   = await res.json();
  if (!Array.isArray(json)) throw new Error(json.msg || 'Balance failed');
  const usdt   = json.find(b => b.asset === 'USDT');
  return usdt ? parseFloat(usdt.availableBalance).toFixed(2) : '0';
}

async function getCandles(symbol, interval, limit) {
  const url = `${BASE_URL()}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res  = await fetchWT(url, {}, 8000);
  if (!res.ok) throw new Error(`Candles HTTP ${res.status}`);
  return res.json();
}

async function getTickerPrice(symbol) {
  const url = `${BASE_URL()}/fapi/v1/ticker/price?symbol=${symbol}`;
  const res  = await fetchWT(url, {}, 5000);
  if (!res.ok) throw new Error(`Ticker HTTP ${res.status}`);
  const j = await res.json();
  return parseFloat(j.price);
}

async function setLeverage(symbol, leverage) {
  const path   = '/fapi/v1/leverage';
  const params = `symbol=${symbol}&leverage=${leverage}&timestamp=${Date.now() + TIME_OFFSET}`;
  const sig    = await sign(params);
  await fetchWT(`${BASE_URL()}${path}`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `${params}&signature=${sig}`
  }, 5000);
}

async function placeMarketOrder(symbol, side, qty) {
  const binanceSide = side === 'LONG' ? 'BUY' : 'SELL';
  const path   = '/fapi/v1/order';
  const params = `symbol=${symbol}&side=${binanceSide}&type=MARKET&quantity=${qty}&timestamp=${Date.now() + TIME_OFFSET}`;
  const sig    = await sign(params);
  const res    = await fetchWT(`${BASE_URL()}${path}`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `${params}&signature=${sig}`
  }, 8000);
  const json = await res.json();
  if (json.code && json.code < 0) throw new Error(json.msg);
  return json;
}

async function refreshSymbolRules(symbol) {
  try {
    const res  = await fetchWT(`${BASE_URL()}/fapi/v1/exchangeInfo`, {}, 10000);
    const json = await res.json();
    const s    = (json.symbols || []).find(x => x.symbol === symbol);
    if (s) {
      const lot  = s.filters.find(f => f.filterType === 'LOT_SIZE');
      SYMBOL_RULES[symbol] = {
        stepSize:          parseFloat(lot?.stepSize  || '0.001'),
        quantityPrecision: s.quantityPrecision || 3
      };
    }
  } catch (e) { log('Rules error', e.message); }
}

function formatQty(symbol, rawQty) {
  const r    = SYMBOL_RULES[symbol];
  const prec = r ? r.quantityPrecision : 3;
  const step = r ? r.stepSize : 0.001;
  const qty  = Math.floor(rawQty / step) * step;
  return qty.toFixed(prec);
}

/* ── HMAC-SHA256 ──────────────────────────────────────────── */
async function sign(msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(API_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function syncTime() {
  try {
    const t1  = Date.now();
    const res  = await fetch(`${BASE_URL()}/fapi/v1/time`);
    const json = await res.json();
    TIME_OFFSET = json.serverTime - (t1 + (Date.now() - t1) / 2);
  } catch (e) { TIME_OFFSET = 0; }
}

async function fetchWT(resource, options = {}, timeout = 6000) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(resource, { ...options, signal: ctrl.signal });
    clearTimeout(id);
    return r;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

/* ── License System ───────────────────────────────────────── */
function isTrialActive() {
  return (Date.now() - INSTALL_TIME) < TRIAL_DURATION;
}

function isSubscriptionActive() {
  if (LICENSE_VALID) return true;
  return isTrialActive();
}

async function validateLicenseKey(key) {
  if (!key) return false;
  const k = key.trim().toUpperCase();
  if (!k.startsWith('FUTURES-AI-PRO-')) return false;
  const providedHash = k.replace('FUTURES-AI-PRO-', '');
  const expected     = await hwHash(DEVICE_ID);
  return providedHash.includes(expected);
}

async function hwHash(devId) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(devId + APP_SECRET));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase().substring(0, 12);
}

function genDeviceId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
}

/* ── Reload Keys from Storage ─────────────────────────────── */
async function reloadKeys() {
  const d = await chrome.storage.local.get([
    'apiKey','apiSecret','useTestnet','savedSettings','deviceId','licenseKey','installTime'
  ]);
  API_KEY      = (d.apiKey    || '').trim();
  API_SECRET   = (d.apiSecret || '').trim();
  USE_TESTNET  = d.useTestnet !== false;
  TRADE_SETTINGS = d.savedSettings || TRADE_SETTINGS;
  DEVICE_ID    = d.deviceId   || DEVICE_ID;
  LICENSE_KEY  = (d.licenseKey || '').trim();
  INSTALL_TIME = d.installTime || INSTALL_TIME;
  LICENSE_VALID = await validateLicenseKey(LICENSE_KEY);
}

/* ════════════════════════════════════════════════════════════
   TECHNICAL INDICATORS
════════════════════════════════════════════════════════════ */
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const result = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  result.push(100 - 100 / (1 + (avgL === 0 ? Infinity : avgG / avgL)));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    result.push(100 - 100 / (1 + (avgL === 0 ? Infinity : avgG / avgL)));
  }
  return result;
}

function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  const result = [closes.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < closes.length; i++) {
    result.push(closes[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

function calcEMAFromArr(arr, period) {
  return calcEMA(arr, period);
}

function zipSub(a, b) {
  if (!a || !b) return null;
  const len = Math.min(a.length, b.length);
  return Array.from({ length: len }, (_, i) => a[i + (a.length - len)] - b[i + (b.length - len)]);
}

/* ── Broadcast Helpers ────────────────────────────────────── */
function broadcastStatus(status) {
  chrome.runtime.sendMessage({ action: 'BOT_STATUS', status }).catch(() => {});
}

function broadcastPosition(pos) {
  chrome.runtime.sendMessage({ action: 'POSITION_UPDATE', position: pos }).catch(() => {});
}

function broadcastLog(text) {
  chrome.runtime.sendMessage({ action: 'ACTION_LOG', text }).catch(() => {});
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic', iconUrl: 'icon.png',
    title, message, priority: 2
  });
}

function log(msg, detail = '') {
  console.log(`[FUTURES-AI] ${msg}`, detail);
  broadcastLog(`${msg} ${detail}`);
}
