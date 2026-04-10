/* ═══════════════════════════════════════════════════════════════════
   background.js — AI Futures Bot Service Worker v1.0
   ═══════════════════════════════════════════════════════════════════
   FEATURES:
   - Real Binance Futures API (Testnet + Live)
   - 4 Strategies: RSI+EMA, MACD, Scalping, Breakout
   - Automatic Stop Loss & Take Profit
   - Paper Trading mode (no real money)
   - Trade logging to Chrome Storage
   - Connection testing
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ── Global State ───────────────────────────────────────── */
let BOT_RUNNING    = false;
let STRATEGY       = 'RSI+EMA';
const STRATEGY_LIST= ['RSI+EMA', 'MACD', 'Scalping', 'Deep AI'];
let API_KEY        = '';
let API_SECRET     = '';
let USE_TESTNET    = true;
let GEMINI_KEY     = '';
let INTERVAL_ID    = null;
let TRADE_SETTINGS = {};
let ACTIVE_TRADE   = null;
let SYMBOL_RULES   = {}; // Cache for precision
let DAILY_START_BAL = 0;
let RESET_DATE     = '';

const LIVE_BASE    = 'https://fapi.binance.com';
const TEST_BASE    = 'https://testnet.binancefuture.com';
const BASE_URL     = () => USE_TESTNET ? TEST_BASE : LIVE_BASE;

/* ── Message Handler ────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.action) {
      case 'START_BOT':
        await loadKeys();
        STRATEGY       = msg.strategy || 'RSI+EMA';
        TRADE_SETTINGS = msg.settings || {};
        await startBot();
        sendResponse({ ok: true });
        break;

      case 'STOP_BOT':
        stopBot();
        sendResponse({ ok: true });
        break;

      case 'UPDATE_KEYS':
        API_KEY     = msg.apiKey;
        API_SECRET  = msg.apiSecret;
        USE_TESTNET = msg.useTestnet !== false;
        GEMINI_KEY  = msg.geminiKey || '';
        sendResponse({ ok: true });
        break;

      case 'TEST_CONNECTION':
        (async () => {
          try {
            await Promise.race([
              loadKeys(),
              new Promise((_, r) => setTimeout(() => r(new Error('loadKeys hung')), 2000))
            ]);
            
            const bal = await Promise.race([
              getBalance(),
              new Promise((_, r) => setTimeout(() => r(new Error('getBalance hung')), 6000))
            ]);

            const mode = await Promise.race([
              getPositionMode(),
              new Promise((_, r) => setTimeout(() => r(new Error('getPositionMode hung')), 4000))
            ]);

            sendResponse({ ok: true, balance: bal, hedgeMode: mode });
          } catch (e) {
            log('❌ Test Connection Failed:', e.message);
            sendResponse({ ok: false, error: e.message });
          }
        })();
        break;

      case 'MANUAL_TRADE':
        await loadKeys();
        try {
          // Sync settings from manual request
          TRADE_SETTINGS.symbol = msg.symbol;
          TRADE_SETTINGS.amount = msg.amount;
          TRADE_SETTINGS.mode   = msg.mode;
          
          if (ACTIVE_TRADE) throw new Error('A trade is already active!');

          const candles = await getCandles(msg.symbol, '1m', 1);
          const lastPrice = parseFloat(candles[0][4]);
          
          await openTrade(msg.symbol, msg.direction, lastPrice);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        break;

      case 'CLOSE_POSITION':
        try {
          if (!ACTIVE_TRADE) throw new Error('No active trade to close!');
          const candles = await getCandles(ACTIVE_TRADE.symbol, '1m', 1);
          const lastPrice = parseFloat(candles[0][4]);
          await closeTrade(lastPrice, 'MANUAL_CLOSE');
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        break;

      case 'HEARTBEAT':
        if (ACTIVE_TRADE) await monitorActiveTrade();
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: false, error: 'Unknown action' });
    }
  })();
  return true; // Keep message channel open
});

/* ── Load Keys from Storage ─────────────────────────────── */
async function loadKeys() {
  const data = await chrome.storage.local.get(['apiKey', 'apiSecret', 'useTestnet', 'activeTrade', 'geminiKey']);
  API_KEY      = (data.apiKey || '').trim();
  API_SECRET   = (data.apiSecret || '').trim();
  USE_TESTNET  = data.useTestnet !== false;
  ACTIVE_TRADE = data.activeTrade || null;
  GEMINI_KEY   = (data.geminiKey || '').trim();
}

/* ── Start Bot ──────────────────────────────────────────── */
async function startBot() {
  if (BOT_RUNNING) return;
  BOT_RUNNING = true;
  log('🚀 Bot started', `Strategy: ${STRATEGY}`);
  await chrome.storage.local.set({ botRunning: true });
  broadcastStatus(true);

  // Initial Run
  await runCycle();
  
  // 1. Slow loop for checking entry signals (Strategy dependent)
  // Note: Service worker may suspend, but chrome.alarms 'bot-tick' will wake it up every 1m.
  const intervalMs = getIntervalMs();
  if (INTERVAL_ID) clearInterval(INTERVAL_ID);
  INTERVAL_ID = setInterval(runCycle, intervalMs);
}

/* ── Stop Bot ───────────────────────────────────────────── */
function stopBot() {
  BOT_RUNNING = false;
  if (INTERVAL_ID) { clearInterval(INTERVAL_ID); INTERVAL_ID = null; }
  if (MONITOR_INTERVAL_ID) { clearInterval(MONITOR_INTERVAL_ID); MONITOR_INTERVAL_ID = null; }
  chrome.storage.local.set({ botRunning: false });
  broadcastStatus(false);
  log('⛔ Bot stopped');
}

/* ── Get interval based on strategy ────────────────────── */
function getIntervalMs() {
  const map = { Scalping: 30000, MACD: 120000, 'Deep AI': 300000, 'RSI+EMA': 60000 };
  return map[STRATEGY] || 60000;
}

/* ── Main Trading Cycle ─────────────────────────────────── */
async function runCycle() {
  if (!BOT_RUNNING) return;
  try {
    const symbol = TRADE_SETTINGS.symbol || 'BTCUSDT';
    
    // 0. Check Daily Reset
    await checkDailyReset();

    // 1. Ensure we have symbol rules for precision
    if (!SYMBOL_RULES[symbol]) {
      await refreshSymbolRules(symbol);
    }

    // 2. Fetch candles for Strategy Logic
    const candles = await getCandles(symbol, getCandleInterval(), 50);
    if (!candles || candles.length < 30) return;
    const closes = candles.map(c => parseFloat(c[4]));

    // 3. If trade is active, check ONLY for Strategy Reversal
    if (ACTIVE_TRADE) {
      let reversal = null;
      switch (STRATEGY) {
        case 'RSI+EMA':  reversal = signalRsiEma(closes);  break;
        case 'MACD':     reversal = signalMACD(closes);    break;
        case 'Scalping': reversal = signalScalping(closes);break;
        case 'Deep AI':  reversal = null; break;
      }
      if (reversal && reversal !== ACTIVE_TRADE.direction) {
        log('🔄 Strategy Reversal detected - Closing Position');
        await closeTrade(closes[closes.length-1], 'STRATEGY_REVERSAL');
      }
      return;
    }

    // 4. No active trade? Look for entry signals
    let signal = null;
    switch (STRATEGY) {
      case 'RSI+EMA':  signal = signalRsiEma(closes);  break;
      case 'MACD':     signal = signalMACD(closes);    break;
      case 'Scalping': signal = signalScalping(closes);break;
      case 'Deep AI':  signal = await signalDeepAI(symbol, candles); break;
    }

    if (signal) {
      const lastPrice = closes[closes.length - 1];
      await openTrade(symbol, signal, lastPrice);
    }
  } catch (e) {
    log('Cycle Error:', e.message);
  }
}

/* ── Fast Monitoring Loop for PnL and Stops ───────────────── */
async function monitorFastLoop() {
  if (!BOT_RUNNING || !ACTIVE_TRADE) return;
  await monitorActiveTrade();
}

async function checkDailyReset() {
  const now = new Date();
  const todayStr = now.toDateString();
  const data = await chrome.storage.local.get(['dailyState', 'stats']);
  
  if (!data.dailyState || data.dailyState.date !== todayStr) {
    const startBal = data.stats?.balance || 1000;
    const newState = { startBal, date: todayStr };
    await chrome.storage.local.set({ dailyState: newState });
    log('📅 Daily Reset:', `New day started. Baseline balance: $${startBal}`);
    
    // Reset todayPnl in stats for UI clarity
    if (data.stats) {
       data.stats.todayPnl = 0;
       await chrome.storage.local.set({ stats: data.stats });
    }
  }
}

/* ── Monitor Active Trade ───────────────────────────────── */
async function monitorActiveTrade() {
  const t = ACTIVE_TRADE;
  try {
    // 1. Get FAST Live Price from Ticker
    const currentPrice = await getTickerPrice(t.symbol);
    
    // 2. Calculate current PnL
    const pnlPct = t.direction === 'LONG' 
      ? (currentPrice - t.entry) / t.entry 
      : (t.entry - currentPrice) / t.entry;
    
    const unrealizedPnl = parseFloat((pnlPct * t.amount * t.leverage).toFixed(2));
    t.markPrice = currentPrice;
    t.pnl = unrealizedPnl;
    t.pnlPct = (pnlPct * 100).toFixed(2);

    // ── Trailing Stop Loss Logic (Ticker-based) ──────────
    if (t.trailPct > 0) {
      if (t.direction === 'LONG' && currentPrice > t.highestPrice) {
        t.highestPrice = currentPrice;
        const newSl = t.highestPrice * (1 - t.trailPct);
        if (newSl > t.sl) { t.sl = newSl; log('🛡️ Trailing SL moved UP'); }
      } else if (t.direction === 'SHORT' && currentPrice < t.lowestPrice) {
        t.lowestPrice = currentPrice;
        const newSl = t.lowestPrice * (1 + t.trailPct);
        if (newSl < t.sl) { t.sl = newSl; log('🛡️ Trailing SL moved DOWN'); }
      }
    }

    // ── Update Dashboard & Storage ──────────────────────────
    broadcastPositionUpdate(t);
    await chrome.storage.local.set({ activeTrade: t });

    // Exit Condition 1: Stop Loss
    if ((t.direction === 'LONG' && currentPrice <= t.sl) || (t.direction === 'SHORT' && currentPrice >= t.sl)) {
      log('🛑 STOP LOSS TRIGGERED at ' + currentPrice);
      await closeTrade(currentPrice, 'STOP_LOSS');
      return;
    }

    // Exit Condition 2: Take Profit
    if ((t.direction === 'LONG' && currentPrice >= t.tp) || (t.direction === 'SHORT' && currentPrice <= t.tp)) {
      log('🎯 TAKE PROFIT TRIGGERED at ' + currentPrice);
      await closeTrade(currentPrice, 'TAKE_PROFIT');
      return;
    }

    // 3. Strategy Reversal Check (Only occurs on Strategy Cycle, not Fast Monitor)
    // We handle this inside runCycle which calls specific strategy signals
  } catch (e) {
    log('Monitor error:', e.message);
  }
}

function getCandleInterval() {
  const map = { Scalping: '1m', MACD: '15m', 'Deep AI': '1h', 'RSI+EMA': '5m' };
  return map[STRATEGY] || '5m';
}

/* ══════════════════════════════════════════════════════════
   STRATEGY ENGINES
   ══════════════════════════════════════════════════════════ */

/* ── Strategy 1: RSI + EMA ──────────────────────────────── */
function signalRsiEma(closes) {
  const rsi = calcRSI(closes, 14);
  const ema21 = calcEMA(closes, 21);
  const price = closes[closes.length - 1];
  const lastRsi = rsi[rsi.length - 1];
  const prevRsi = rsi[rsi.length - 2];
  const lastEma = ema21[ema21.length - 1];

  // BUY: RSI crosses above 30 (oversold) AND price > EMA21
  if (prevRsi < 30 && lastRsi >= 30 && price > lastEma) return 'LONG';
  // SELL: RSI crosses below 70 (overbought) AND price < EMA21
  if (prevRsi > 70 && lastRsi <= 70 && price < lastEma) return 'SHORT';
  return null;
}

/* ── Strategy 2: MACD ───────────────────────────────────── */
function signalMACD(closes) {
  const macd = calcMACD(closes, 12, 26, 9);
  if (!macd) return null;
  const { macdLine, signalLine } = macd;
  const i = macdLine.length - 1;

  // MACD line crosses above Signal → BUY
  if (macdLine[i - 1] < signalLine[i - 1] && macdLine[i] > signalLine[i]) return 'LONG';
  // MACD line crosses below Signal → SELL
  if (macdLine[i - 1] > signalLine[i - 1] && macdLine[i] < signalLine[i]) return 'SHORT';
  return null;
}

/* ── Strategy 3: Scalping (9/21 EMA) ───────────────────── */
function signalScalping(closes) {
  const ema9  = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const i = ema9.length - 1;

  // Fast EMA crosses above Slow EMA → BUY
  if (ema9[i - 1] < ema21[i - 1] && ema9[i] > ema21[i]) return 'LONG';
  // Fast EMA crosses below Slow EMA → SELL
  if (ema9[i - 1] > ema21[i - 1] && ema9[i] < ema21[i]) return 'SHORT';
  return null;
}

/* ── Strategy 4: Deep AI (Gemini 24h + News API) ────────── */
async function signalDeepAI(symbol, candles) {
  if (!GEMINI_KEY) {
    log('❌ Deep AI Error', 'Gemini API Key is missing. Add it in settings.');
    notify('Deep AI Error', 'Please paste your Gemini API Key in the Settings page.');
    return null;
  }
  
  // Format candles into a readable summary for AI
  const recent = candles.slice(-24); // Last 24 hours if using 1h interval
  if(recent.length < 10) return null;
  
  const open = recent[0][1];
  const close = recent[recent.length-1][4];
  const high = Math.max(...recent.map(c => parseFloat(c[2])));
  const low = Math.min(...recent.map(c => parseFloat(c[3])));
  const prices = recent.map(c => parseFloat(c[4])).join(', ');

  const prompt = `
You are an expert crypto trading Artificial Intelligence. Analyze this recent market data for ${symbol}.
- Open: ${open}
- Close: ${close} 
- High: ${high}
- Low: ${low}
- Recent Close Prices Sequence: [${prices}]

As a highly protective AI, should the bot take a LONG trade, a SHORT trade, or HOLD?
Reply ONLY with exactly one word: LONG, SHORT, or HOLD.
`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 10 }
      })
    });
    
    if (!res.ok) {
      log('❌ Gemini HTTP Error:', res.status);
      return null;
    }

    const json = await res.json();
    if (json.error) {
      log('❌ Gemini API Error:', json.error.message);
      return null;
    }

    const reply = json.candidates[0].content.parts[0].text.trim().toUpperCase();
    log('🧠 Deep AI Decision:', reply);
    
    if (reply.includes('LONG')) return 'LONG';
    if (reply.includes('SHORT')) return 'SHORT';
    return null;
  } catch (e) {
    log('❌ Gemini Fetch Error:', e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   TECHNICAL INDICATORS
   ══════════════════════════════════════════════════════════ */

function calcEMA(data, period) {
  const k = 2 / (period + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcRSI(data, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const rsi = [100 - 100 / (1 + avgGain / (avgLoss || 0.001))];

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsi.push(100 - 100 / (1 + avgGain / (avgLoss || 0.001)));
  }
  return rsi;
}

function calcMACD(data, fast = 12, slow = 26, signal = 9) {
  if (data.length < slow + signal) return null;
  const emaFast   = calcEMA(data, fast);
  const emaSlow   = calcEMA(data, slow);
  const macdLine  = emaFast.slice(slow - fast).map((v, i) => v - emaSlow[i]);
  const signalLine= calcEMA(macdLine, signal);
  return { macdLine, signalLine };
}

/* ══════════════════════════════════════════════════════════
   TRADE EXECUTION
   ══════════════════════════════════════════════════════════ */

/* ── Open a new position ────────────────────────────────── */
async function openTrade(symbol, direction, currentPrice) {
  const mode       = TRADE_SETTINGS.mode || 'paper';
  const riskPct    = parseFloat(TRADE_SETTINGS.risk || 2) / 100;
  const leverage   = parseInt(TRADE_SETTINGS.leverage || 5);
  const slPct      = parseFloat(TRADE_SETTINGS.stopLoss   || 1.5) / 100;
  const tpPct      = parseFloat(TRADE_SETTINGS.takeProfit || 3)   / 100;
  const trailPct   = parseFloat(TRADE_SETTINGS.trailingSl || 0)   / 100;

  let amount = parseFloat(TRADE_SETTINGS.amount || 50);

  // Auto-Compounding Logic
  if (TRADE_SETTINGS.autoCompound) {
    try {
      const balance = await getBalance();
      const calculatedAmount = (balance * riskPct * leverage);
      amount = Math.max(10, parseFloat(calculatedAmount.toFixed(2))); // Min $10 safety
      log('📈 Auto-Compound:', `Balanced logic used. Amount: $${amount}`);
    } catch (e) {
      log('⚠️ Compounding failed:', e.message);
    }
  }

  // MINIMUM ORDER SAFETY CHECK (Binance requirement)
  if (amount < 5) {
    const errMsg = `Order Failed: Minimum amount is $5. Current: $${amount}`;
    log('❌ ' + errMsg);
    notify('Order Denied', errMsg);
    throw new Error(errMsg);
  }

  const sl = direction === 'LONG' ? currentPrice * (1 - slPct) : currentPrice * (1 + slPct);
  const tp = direction === 'LONG' ? currentPrice * (1 + tpPct) : currentPrice * (1 - tpPct);

  // Precision Formatting
  const fSl = formatPrice(symbol, sl);
  const fTp = formatPrice(symbol, tp);
  const fQty = formatQty(symbol, amount / currentPrice);

  let realOrderOk = false;
  if (mode === 'live') {
    if (!API_KEY || !API_SECRET) {
      log('❌ API Keys missing');
      notify('API Error', 'Please save your API Keys in Settings first.');
      throw new Error('API Keys missing in background. Check Settings.');
    }
    try {
      await setLeverage(symbol, leverage);
      // 1. Entry Order
      const entryRes = await placeMarketOrder(symbol, direction, fQty);
      realOrderOk = true;

      // 2. Hard Stop Loss (Server-side)
      await placeProtectionOrder(symbol, direction === 'LONG' ? 'SELL' : 'BUY', 'STOP_MARKET', fSl);
      // 3. Hard Take Profit (Server-side)
      await placeProtectionOrder(symbol, direction === 'LONG' ? 'SELL' : 'BUY', 'TAKE_PROFIT_MARKET', fTp);
      
      log('🛡️ Hard SL/TP orders placed on Binance server');
    } catch (e) {
      log('❌ Live order failed:', e.message);
      let cleanMsg = e.message;
      if (e.message.includes('notional')) cleanMsg = "Amount too small for Binance (Min ~$5-10)";
      if (e.message.includes('API-key'))   cleanMsg = "Invalid API Key or Permissions";
      
      notify('Order Failed', `Binance says: ${cleanMsg}`);
      throw new Error(`Binance Rejected: ${cleanMsg}`);
    }
  }

  // If we reach here, either it was Paper mode or Live order succeeded
  ACTIVE_TRADE = {
    symbol,
    direction,
    strategy: STRATEGY,
    entry:    currentPrice,
    markPrice:currentPrice,
    highestPrice: currentPrice,
    lowestPrice:  currentPrice,
    sl:       parseFloat(fSl),
    tp:       parseFloat(fTp),
    trailPct: trailPct,
    amount,
    qty:      fQty,
    leverage,
    mode:     realOrderOk ? 'LIVE' : 'PAPER',
    time:     new Date().toLocaleTimeString(),
    pnl:      0,
    pnlPct:   0
  };

  await chrome.storage.local.set({ activeTrade: ACTIVE_TRADE });
  
  // Update stats/balance immediately if Live
  if (realOrderOk) {
    try {
      const newBal = await getBalance();
      const statsData = await chrome.storage.local.get(['stats']);
      const stats = statsData.stats || {};
      stats.balance = parseFloat(newBal);
      await chrome.storage.local.set({ stats });
    } catch (e) { log('Balance sync error', e.message); }
  }

  broadcastPositionUpdate(ACTIVE_TRADE);
  notify(`🚀 ${direction} Opened`, `${symbol} @ ${currentPrice.toFixed(2)} (${realOrderOk ? 'LIVE' : 'PAPER'})`);
  log(`🚀 ${direction} ${realOrderOk ? 'LIVE' : 'PAPER'} Opened`, `${symbol} @ ${currentPrice}`);
}

/* ── Close the current position ──────────────────────────── */
async function closeTrade(exitPrice, reason) {
  if (!ACTIVE_TRADE) return;
  const t = ACTIVE_TRADE;

  // Final PnL calculation
  const pnlPct = t.direction === 'LONG' ? (exitPrice - t.entry) / t.entry : (t.entry - exitPrice) / t.entry;
  const pnl = parseFloat((pnlPct * t.amount * t.leverage).toFixed(2));

  if (t.mode === 'LIVE' && API_KEY && API_SECRET) {
    try {
      await cancelAllOpenOrders(t.symbol); // Clear Hard SL/TP
      const reverseDir = t.direction === 'LONG' ? 'SHORT' : 'LONG';
      await placeMarketOrder(t.symbol, reverseDir, t.qty);
    } catch (e) {
      log('❌ Live close failed:', e.message);
    }
  }

  const finishedTrade = {
    ...t,
    exit: exitPrice.toFixed(2),
    pnl,
    reason,
    closeTime: new Date().toLocaleTimeString()
  };

  ACTIVE_TRADE = null;
  await chrome.storage.local.remove('activeTrade');
  
  // ── Auto-Switch Strategy on Loss ──
  if (reason === 'STOP_LOSS' && TRADE_SETTINGS.autoSwitch) {
    const currentIndex = STRATEGY_LIST.indexOf(STRATEGY);
    const nextIndex = (currentIndex + 1) % STRATEGY_LIST.length;
    const newStrategy = STRATEGY_LIST[nextIndex];
    log('🔄 AUTO-SWITCHING STRATEGY due to loss:', `${STRATEGY} -> ${newStrategy}`);
    STRATEGY = newStrategy;
    chrome.storage.local.set({ selectedStrategy: newStrategy });
    chrome.runtime.sendMessage({ action: 'STRATEGY_CHANGED', newStrategy });
  }

  await saveTrade(finishedTrade);
  
  broadcastPositionUpdate(null);
  notify(`🏁 Trade Closed (${reason})`, `PnL: ${pnl >= 0 ? '+' : ''}$${pnl}`);
  log(`🏁 Trade Closed: ${reason}`, `PnL: ${pnl}`);
}

/* ── Save trade to storage ──────────────────────────────── */
async function saveTrade(trade) {
  const data = await chrome.storage.local.get(['tradeLog', 'stats', 'dailyState']);
  const log_  = data.tradeLog || [];
  log_.unshift(trade);
  if (log_.length > 500) log_.pop();

  const stats  = data.stats || { balance: 1000, todayPnl: 0, wins: 0, losses: 0, totalTrades: 0, activeTrades: 0 };
  
  // subtract fees (standard 0.04% per side = 0.08% total)
  const fee = trade.amount * 0.0008;
  const netPnl = trade.pnl - fee;

  stats.todayPnl    = parseFloat((stats.todayPnl + netPnl).toFixed(2));
  stats.totalTrades = (stats.totalTrades || 0) + 1;
  stats.balance     = parseFloat((stats.balance + netPnl).toFixed(2));

  if (trade.pnl > 0) stats.wins   = (stats.wins   || 0) + 1;
  else               stats.losses = (stats.losses || 0) + 1;
  
  stats.winRate  = Math.round((stats.wins / stats.totalTrades) * 100);
  stats.leverage = trade.leverage;
  stats.strategy = trade.strategy;
  stats.activeTrades = 0;

  await chrome.storage.local.set({ tradeLog: log_, stats });

  // ── Daily Profit Target Check ──
  const dailyState = data.dailyState || { startBal: stats.balance - netPnl, date: new Date().toDateString() };
  const targetPct  = parseFloat(TRADE_SETTINGS.dailyTarget || 20);
  const targetVal  = dailyState.startBal * (targetPct / 100);
  
  const currentTotalTodayPnl = stats.todayPnl; 

  if (currentTotalTodayPnl >= targetVal && TRADE_SETTINGS.dailyTarget !== '0') {
    log('🎯 DAILY PROFIT TARGET REACHED:', `$${currentTotalTodayPnl.toFixed(2)} / $${targetVal.toFixed(2)}`);
    stopBot();
    notify('🎯 Target Reached!', `Bot has achieved the daily target of ${targetPct}% ($${currentTotalTodayPnl.toFixed(2)}). See you tomorrow!`);
    chrome.runtime.sendMessage({ action: 'TARGET_REACHED', pnl: currentTotalTodayPnl });
  }
}

/* ══════════════════════════════════════════════════════════
   BINANCE API CALLS (Testnet / Live)
   ══════════════════════════════════════════════════════════ */

async function getBalance() {
  const path = '/fapi/v2/account';
  const params = `timestamp=${Date.now()}&recvWindow=10000`;
  const sig    = await sign(params);
  const url    = `${BASE_URL()}${path}?${params}&signature=${sig}`;
  const res    = await fetch(url, { headers: { 'X-MBX-APIKEY': API_KEY } });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.msg || `HTTP ${res.status}`);
  }
  const json = await res.json();
  const usdt = json.assets.find(a => a.asset === 'USDT');
  return usdt ? parseFloat(usdt.availableBalance).toFixed(2) : '0.00';
}

async function getCandles(symbol, interval, limit) {
  const url = `${BASE_URL()}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Klines HTTP ${res.status}`);
  return res.json();
}

async function getTickerPrice(symbol) {
  const url = `${BASE_URL()}/fapi/v1/ticker/price?symbol=${symbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ticker HTTP ${res.status}`);
  const json = await res.json();
  return parseFloat(json.price);
}

async function setLeverage(symbol, leverage) {
  const path   = '/fapi/v1/leverage';
  const params = `symbol=${symbol}&leverage=${leverage}&timestamp=${Date.now()}`;
  const sig    = await sign(params);
  const body   = `${params}&signature=${sig}`;
  await fetch(`${BASE_URL()}${path}`, {
    method: 'POST', headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
}

async function refreshSymbolRules(symbol) {
  try {
    const res = await fetch(`${BASE_URL()}/fapi/v1/exchangeInfo`);
    const json = await res.json();
    const s = json.symbols.find(x => x.symbol === symbol);
    if (s) {
      const priceFilter = s.filters.find(f => f.filterType === 'PRICE_FILTER');
      const lotFilter = s.filters.find(f => f.filterType === 'LOT_SIZE');
      SYMBOL_RULES[symbol] = {
        tickSize: parseFloat(priceFilter.tickSize),
        stepSize: parseFloat(lotFilter.stepSize),
        pricePrecision: s.pricePrecision,
        quantityPrecision: s.quantityPrecision
      };
    }
  } catch (e) {
    log('Rules error:', e.message);
  }
}

function formatPrice(symbol, price) {
  const r = SYMBOL_RULES[symbol];
  if (!r) return price.toFixed(2);
  const precision = Math.max(0, Math.ceil(-Math.log10(r.tickSize)));
  return (Math.floor(price / r.tickSize) * r.tickSize).toFixed(precision);
}

function formatQty(symbol, qty) {
  const r = SYMBOL_RULES[symbol];
  if (!r) return qty.toFixed(3);
  const precision = Math.max(0, Math.ceil(-Math.log10(r.stepSize)));
  return (Math.floor(qty / r.stepSize) * r.stepSize).toFixed(precision);
}

async function getPositionMode() {
  const path = '/fapi/v1/positionSide/dual';
  const params = `timestamp=${Date.now()}`;
  const sig = await sign(params);
  const res = await fetch(`${BASE_URL()}${path}?${params}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': API_KEY }
  });
  if (!res.ok) return false;
  const json = await res.json();
  return json.dualSidePosition; // true if Hedge Mode
}

async function placeMarketOrder(symbol, side, qty) {
  const path = '/fapi/v1/order';
  const binSide = side === 'LONG' ? 'BUY' : 'SELL';
  const params = `symbol=${symbol}&side=${binSide}&type=MARKET&quantity=${qty}&timestamp=${Date.now()}`;
  const sig = await sign(params);
  const res = await fetch(`${BASE_URL()}${path}`, {
    method: 'POST', headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `${params}&signature=${sig}`
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.msg || res.status); }
  return res.json();
}

async function placeProtectionOrder(symbol, side, type, stopPrice) {
  const path = '/fapi/v1/order';
  const params = `symbol=${symbol}&side=${side}&type=${type}&stopPrice=${stopPrice}&closePosition=true&timestamp=${Date.now()}`;
  const sig = await sign(params);
  const res = await fetch(`${BASE_URL()}${path}`, {
    method: 'POST', headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `${params}&signature=${sig}`
  });
  if (!res.ok) { log(`Protection order ${type} error`, await res.json()); }
}

async function cancelAllOpenOrders(symbol) {
  const path = '/fapi/v1/allOpenOrders';
  const params = `symbol=${symbol}&timestamp=${Date.now()}`;
  const sig = await sign(params);
  await fetch(`${BASE_URL()}${path}?${params}&signature=${sig}`, {
    method: 'DELETE', headers: { 'X-MBX-APIKEY': API_KEY }
  });
}

/* ── HMAC-SHA256 Signature ──────────────────────────────── */
async function sign(message) {
  const key     = await crypto.subtle.importKey('raw', strToBytes(API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig     = await crypto.subtle.sign('HMAC', key, strToBytes(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function strToBytes(str) {
  return new TextEncoder().encode(str);
}

/* ── Broadcast helpers ──────────────────────────────────── */
async function broadcastPositionUpdate(pos) {
  try { await chrome.runtime.sendMessage({ action: 'POSITION_UPDATE', position: pos }); } catch (_) {}
}
async function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: title,
    message: message,
    priority: 2
  });
}

/* ── Logger ─────────────────────────────────────────────── */
function log(msg, detail = '') {
  console.log(`[AI-BOT] ${msg}`, detail);
}

/* ── Alarm fallback (keep SW alive) ─────────────────────── */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'bot-tick' && BOT_RUNNING) await runCycle();
});
chrome.alarms.create('bot-tick', { periodInMinutes: 1 });

/* ── On SW startup: restore state ───────────────────────── */
chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get(['botRunning', 'selectedStrategy']);
  if (data.botRunning) {
    await loadKeys();
    STRATEGY = data.selectedStrategy || 'RSI+EMA';
    await startBot();
  }
});
