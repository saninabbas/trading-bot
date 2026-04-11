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
let LAST_SWITCH_TIME = 0;
let STRATEGY_LOCKED_UNTIL = 0;
let IDLE_SCAN_COUNT = 0; 
let MONITOR_INTERVAL_ID = null;

let LICENSE_KEY    = '';
let LICENSE_VALID  = false;
let TIME_OFFSET    = 0; 

const LIVE_BASE    = 'https://fapi.binance.com';
const TEST_BASE    = 'https://testnet.binancefuture.com';
const BASE_URL     = () => USE_TESTNET ? TEST_BASE : LIVE_BASE;

// Heartbeat to prevent suspension
setInterval(() => {
  if (BOT_RUNNING) {
    chrome.runtime.sendMessage({ action: 'HEARTBEAT', time: Date.now() }).catch(()=>{});
  }
}, 5000);

/* ── Master Message Handler ────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 1. INSTANT SYNC HANDLERS (Must not be blocked by async tasks)
  if (msg.action === 'GET_SYSTEM_HEALTH') {
    sendResponse({
      api: !!API_KEY && !!API_SECRET,
      ai: !!GEMINI_KEY,
      mode: USE_TESTNET ? 'TESTNET' : 'LIVE',
      idleCount: Number(IDLE_SCAN_COUNT) || 0,
      active: BOT_RUNNING
    });
    return false; // Done instantly
  }

  // 2. ASYNC HANDLERS
  const handleMessage = async () => {
    try {
      if (['START_BOT', 'FORCE_TRADE', 'TEST_CONNECTION', 'CLOSE_POSITION', 'FORCE_CLEAR_TRADE', 'MANUAL_TRADE'].includes(msg.action)) {
        await loadKeys();
      }

      switch (msg.action) {
        case 'START_BOT':
          STRATEGY = msg.strategy || 'RSI+EMA';
          TRADE_SETTINGS = msg.settings || {};
          const started = await startBot();
          sendResponse({ ok: started });
          break;
        case 'STOP_BOT':
          stopBot();
          sendResponse({ ok: true });
          break;
        case 'FORCE_TRADE':
          const price = await getTickerPrice(msg.symbol || 'BTCUSDT');
          broadcastStatus(true, `⚡ FORCING Long on ${msg.symbol || 'BTCUSDT'}...`);
          await openTrade(msg.symbol || 'BTCUSDT', 'LONG', price);
          sendResponse({ ok: true });
          break;
        case 'MANUAL_TRADE':
          if (ACTIVE_TRADE) throw new Error('A trade is already open. Close it first.');
          if (msg.settings) TRADE_SETTINGS = msg.settings;
          const manualPrice = await getTickerPrice(msg.symbol || 'BTCUSDT');
          broadcastStatus(true, `🖐 Manual ${msg.direction} on ${msg.symbol || 'BTCUSDT'}...`);
          await openTrade(msg.symbol || 'BTCUSDT', msg.direction || 'LONG', manualPrice);
          sendResponse({ ok: true });
          break;
        case 'TEST_CONNECTION':
          const pingRes = await fetch(`${BASE_URL()}/fapi/v1/ping`);
          if (pingRes.ok) {
            const bal = await getBalance();
            sendResponse({ ok: true, balance: bal, mode: USE_TESTNET ? 'Testnet' : 'Live' });
          } else { sendResponse({ ok: false, error: 'Binance Ping Failed' }); }
          break;
        case 'UPDATE_STRATEGY':
          STRATEGY = msg.strategy;
          STRATEGY_LOCKED_UNTIL = Date.now() + 600000;
          chrome.storage.local.set({ selectedStrategy: STRATEGY, strategyLockedUntil: STRATEGY_LOCKED_UNTIL });
          if (BOT_RUNNING) { 
            if (INTERVAL_ID) clearInterval(INTERVAL_ID);
            INTERVAL_ID = setInterval(runCycle, getIntervalMs());
          }
          sendResponse({ ok: true });
          break;
        case 'CLOSE_POSITION':
          if (!ACTIVE_TRADE) throw new Error('No active trade');
          const lastPrice = await getTickerPrice(ACTIVE_TRADE.symbol);
          await closeTrade(lastPrice, 'MANUAL_CLOSE');
          sendResponse({ ok: true });
          break;
        case 'UPDATE_KEYS':
          API_KEY = msg.apiKey; 
          API_SECRET = msg.apiSecret; 
          USE_TESTNET = msg.useTestnet !== false; 
          GEMINI_KEY = msg.geminiKey || '';
          sendResponse({ ok: true });
          break;
        case 'FORCE_CLEAR_TRADE':
          ACTIVE_TRADE = null;
          await chrome.storage.local.remove('activeTrade');
          broadcastPositionUpdate(null);
          sendResponse({ ok: true });
          break;
        case 'HEARTBEAT':
          if (msg.strategy && msg.strategy !== STRATEGY && Date.now() > STRATEGY_LOCKED_UNTIL) STRATEGY = msg.strategy;
          if (ACTIVE_TRADE) monitorActiveTrade().catch(()=>{});
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: 'Unknown action' });
      }
    } catch (e) {
      log(`❌ Message Error [${msg.action}]:`, e.message);
      sendResponse({ ok: false, error: e.message });
    }
  };

  handleMessage();
  return true; 
});

/* ── Load Keys from Storage ─────────────────────────────── */
async function loadKeys() {
  const data = await chrome.storage.local.get(['apiKey', 'apiSecret', 'useTestnet', 'activeTrade', 'geminiKey', 'licenseKey', 'licenseStatus']);
  API_KEY      = (data.apiKey || '').trim();
  API_SECRET   = (data.apiSecret || '').trim();
  USE_TESTNET  = data.useTestnet !== false;
  ACTIVE_TRADE = data.activeTrade || null;
  GEMINI_KEY   = (data.geminiKey || '').trim();
  LICENSE_KEY  = (data.licenseKey || '').trim();
  if (data.licenseStatus) LICENSE_VALID = data.licenseStatus.valid;
}

/* ── Start Bot ──────────────────────────────────────────── */
async function startBot() {
  if (BOT_RUNNING) return;

  BOT_RUNNING = true;
  await syncWithBinanceTime();
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
  return true;
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
  const map = { Scalping: 30000, MACD: 120000, 'Deep AI': 30000, 'RSI+EMA': 30000 };
  return map[STRATEGY] || 60000;
}

/* ── Main Trading Cycle ─────────────────────────────────── */
async function runCycle() {
  if (!BOT_RUNNING) return;
  try {
    // FORCE RELOAD KEYS BEFORE EVERY CYCLE TO ENSURE NO 'MISSING' ERRORS
    if (!API_KEY || !API_SECRET) await loadKeys();
    
    await checkDailyReset();

    // 1. Determine Symbols to monitor
    let symbolsToScan = [TRADE_SETTINGS.symbol || 'BTCUSDT'];
    let globalNews = [];

    // Autonomous Brain: If Deep AI selected and no trade, ask Gemini to pick
    if (!ACTIVE_TRADE && STRATEGY === 'Deep AI') {
      broadcastStatus(true, "🧠 AI Analysis in progress...");
      
      // Wrap AI in a 10-second timeout
      const verdict = await Promise.race([
        getAutonomousVerdict(),
        new Promise(r => setTimeout(() => r({ direction: 'TIMEOUT' }), 10000))
      ]);

      if (verdict.direction === 'TIMEOUT') {
        broadcastStatus(true, "⚠️ AI Slow. Falling back to Technical Scan...");
      } else if (verdict.coin && verdict.direction && verdict.direction !== 'HOLD') {
         // HIGH CONVICTION AI TRADE FOUND
         broadcastStatus(true, `🚀 AI SIGNAL: ${verdict.direction} on ${verdict.coin}`);
         await openTrade(verdict.coin, verdict.direction, await getTickerPrice(verdict.coin));
         return; 
      }
      
      // FALLBACK: If AI was neutral (NONE) or returned HOLD, perform technical scan on Top 20 instantly
      if (verdict.direction !== 'TIMEOUT') broadcastStatus(true, "📡 AI Neutral. Running Technical Scanner...");
      const topCoins = await getTopVolumeCoins(20);
      const coreCoins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
      symbolsToScan = [...new Set([...symbolsToScan, ...topCoins, ...coreCoins])];
      globalNews = verdict.news;
    } else if (!ACTIVE_TRADE) {
      const topCoins = await getTopVolumeCoins(20);
      const coreCoins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
      symbolsToScan = [...new Set([...symbolsToScan, ...topCoins, ...coreCoins])];
    }
    
    // 2. Shuffle to ensure diverse coin selection
    symbolsToScan = shuffleArray(symbolsToScan);

    // 3. Iterate and Scan
    let fallbackToRSI = (STRATEGY === 'Deep AI'); 
    
    for (const symObj of symbolsToScan) {
      try {
        if (!BOT_RUNNING) break;
        
        const symbol = typeof symObj === 'string' ? symObj : symObj.symbol;
        if (ACTIVE_TRADE && ACTIVE_TRADE.symbol !== symbol) continue;

        if (!ACTIVE_TRADE) {
           broadcastStatus(true, `📡 Scanning ${symbol}... (Looking for Signal)`);
        }

        if (!SYMBOL_RULES[symbol]) await refreshSymbolRules(symbol);

        const interval = getCandleInterval();
        const candles = await getCandles(symbol, interval, 120);
        if (!candles || candles.length < 50) continue;
        
        const closes  = candles.map(c => parseFloat(c[4]));
        const volumes = candles.map(c => parseFloat(c[5]));

        // Detect signal based on current strategy or hybrid fallback
        const currentCheckStrat = fallbackToRSI ? 'RSI+EMA' : STRATEGY;
        const signal = await getSignal(symbol, currentCheckStrat, closes, volumes, candles, globalNews);

        if (!signal) {
           const lastRsi = calcRSI(closes, 14).pop();
           broadcastStatus(true, `🔍 ${symbol}: RSI ${lastRsi.toFixed(0)} (${fallbackToRSI ? 'Math' : 'AI'})`);
        } else if (signal === 'LONG' || signal === 'SHORT') {
           if (!ACTIVE_TRADE) {
             broadcastStatus(true, `🔥 Launching ${signal} on ${symbol}...`);
             await openTrade(symbol, signal, closes[closes.length-1]);
             return; 
           }
        }

        if (ACTIVE_TRADE && (signal === 'EXIT' || (signal && signal !== ACTIVE_TRADE.direction))) {
            const reason = signal === 'EXIT' ? 'SOCIAL_EXIT (NEWS)' : 'STRATEGY_REVERSAL';
            log(`🔄 ${reason} on ${symbol}`);
            await closeTrade(closes[closes.length-1], reason);
            return;
        }
      } catch (symbolErr) {
        log(`⚠️ Error scanning ${typeof symObj === 'string' ? symObj : symObj.symbol}:`, symbolErr.message);
        continue;
      }
    } // ← end of symbol scan loop

    // 3. Emergency Momentum Entry (If flat for ~1.5 mins - 3 scans)
    if (!ACTIVE_TRADE && IDLE_SCAN_COUNT >= 3) {
      broadcastStatus(true, "🚨 BOT IS IMPATIENT! Forcing Momentum Entry...");
      const topStats = await getTopVolumeCoins(5);
      if (topStats.length > 0) {
        const target = topStats.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
        const dir = target.change >= 0 ? 'LONG' : 'SHORT';
        broadcastStatus(true, `🔥 EMERGENCY ACTIVATED: ${dir} on ${target.symbol}`);
        IDLE_SCAN_COUNT = 0; 
        await openTrade(target.symbol, dir, await getTickerPrice(target.symbol));
        return;
      }
    }

    if (!ACTIVE_TRADE) {
      broadcastStatus(true, `🔍 Cycle ${IDLE_SCAN_COUNT+1} Done. No signal found (Waiting...)`);
    }
    IDLE_SCAN_COUNT++; 
  } catch (e) {
    log('Cycle Error:', e.message);
    broadcastStatus(true, `⚠️ Cycle Error: ${e.message}`);
  }
}

/* ── Monitor Active Trade ───────────────────────────────── */
async function monitorActiveTrade() {
  if (!ACTIVE_TRADE) return;
  const t = ACTIVE_TRADE;
  try {
    const currentPrice = await getTickerPrice(t.symbol);
    
    const pnlPct = t.direction === 'LONG' 
      ? (currentPrice - t.entry) / t.entry 
      : (t.entry - currentPrice) / t.entry;
    
    t.markPrice = currentPrice;
    t.pnl = parseFloat((pnlPct * t.amount * t.leverage).toFixed(2));
    t.pnlPct = (pnlPct * 100).toFixed(2);

    // Update Dashboard & Storage
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

    // Exit Condition 3: Time-Based Rules (30 min limit)
    const durationMins = (Date.now() - t.openedAt) / 60000;
    
    // Rule A: Cross 30 mins and profitable? Close.
    if (durationMins >= 30 && t.pnl > 0) {
      log('⌛ Time-based Profit Exit triggered (>30m)');
      await closeTrade(currentPrice, 'TIME_LIMIT_PROFIT');
      return;
    }

    // Rule B: Cross 30 mins, in loss, but price returns to capital (Breakeven)? Close.
    if (durationMins >= 30 && t.pnl <= 0) {
      const isRecovered = t.direction === 'LONG' ? (currentPrice >= t.entry) : (currentPrice <= t.entry);
      if (isRecovered) {
        log('⌛ Time-based Breakeven Recovery triggered (>30m)');
        await closeTrade(currentPrice, 'TIME_LIMIT_BREAKEVEN');
        return;
      }
    }

    // Exit Condition 4: Social Exit (Every 5 mins check)
    if (STRATEGY === 'Deep AI') {
      const nowS = Math.floor(Date.now() / 1000);
      if (!t.lastAiCheck || nowS - t.lastAiCheck > 300) {
        t.lastAiCheck = nowS;
        const interval = getCandleInterval();
        const candles = await getCandles(t.symbol, interval, 100);
        const news = await fetchMarketNews();
        const signal = await signalDeepAI(t.symbol, candles, news);
        if (signal === 'EXIT') {
          log('🚨 Social Exit Triggered (Emergency News)');
          notify('Emergency Social Exit', `${t.symbol} closed due to negative AI sentiment.`);
          await closeTrade(currentPrice, 'SOCIAL_EXIT');
          return;
        }
      }
    }
  } catch (e) {
    log('Monitor error:', e.message);
  }
}

async function getSignal(symbol, strategy, closes, volumes, candles = null, news = []) {
  if (strategy === 'Deep AI') {
    // 1. AI VERDICT
    const aiSignal = await signalDeepAI(symbol, candles, news);
    if (!aiSignal || aiSignal === 'HOLD') return null;
    if (aiSignal === 'EXIT') return 'EXIT';

    // 2. TECHNICAL VERDICT (RSI/EMA)
    const techSignal = signalRsiEma(closes, volumes);
    
    // 3. TREND VERDICT (24h Chart)
    const ticker = await getTicker24h(symbol);
    const change = ticker ? parseFloat(ticker.priceChangePercent) : 0;
    const trendSignal = change > 0 ? 'LONG' : 'SHORT';

    log(`🔍 Triple Check [${symbol}]: AI:${aiSignal} | Tech:${techSignal} | Trend:${trendSignal} (${change}%)`);

    // CONFLICT RESOLUTION: Only enter if AI and Tech agree AND trend isn't strongly opposing
    if (aiSignal === 'LONG' && techSignal === 'LONG' && change > -1) return 'LONG';
    if (aiSignal === 'SHORT' && techSignal === 'SHORT' && change < 1) return 'SHORT';

    return null; // Not enough consensus
  }

  switch (strategy) {
    case 'RSI+EMA':  return signalRsiEma(closes, volumes);
    case 'MACD':     return signalMACD(closes, volumes);
    case 'Scalping': return signalScalping(closes, volumes);
    case 'Deep AI':  return signalDeepAI(symbol, candles, news); 
    default: return null;
  }
}

async function getTopVolumeCoins(limit = 10) {
  try {
    const res = await fetchWithTimeout(`${BASE_URL()}/fapi/v1/ticker/24hr`, {}, 8000);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    
    // Return objects with stats instead of just symbols
    return data
      .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('_') && !t.symbol.includes('UP') && !t.symbol.includes('DOWN'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map(t => ({
        symbol: t.symbol,
        change: parseFloat(t.priceChangePercent),
        volume: parseFloat(t.quoteVolume)
      }));
  } catch (e) {
    return [];
  }
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
    
    if (data.stats) {
       data.stats.todayPnl = 0;
       await chrome.storage.local.set({ stats: data.stats });
    }
  }
}

function getCandleInterval() {
  const map = { Scalping: '1m', MACD: '15m', 'Deep AI': '5m', 'RSI+EMA': '5m' };
  return map[STRATEGY] || '5m';
}

/* ══════════════════════════════════════════════════════════
   STRATEGY ENGINES
   ══════════════════════════════════════════════════════════ */

/* ── Strategy 1: RSI + EMA (Tuned) ───────────────────────── */
function signalRsiEma(closes, volumes) {
  const rsi = calcRSI(closes, 14);
  const ema21 = calcEMA(closes, 21);
  const price = closes[closes.length - 1];
  const lastRsi = rsi[rsi.length - 1];
  const lastEma = ema21[ema21.length - 1];

  // Volume verification DISABLED for max activity
  // const volEMA = calcEMA(volumes, 20);
  // if (volumes[volumes.length - 1] < volEMA[volEMA.length - 1] * 0.5) return null;

  // ENTRY: Tightened for quality (45/55)
  if (lastRsi < 45) return 'LONG';
  if (lastRsi > 55) return 'SHORT';
  
  return null;
}

/* ── Strategy 2: MACD (Pro) ─────────────────────────────── */
function signalMACD(closes, volumes) {
  const macd = calcMACD(closes, 12, 26, 9);
  if (!macd) return null;
  const { macdLine, signalLine } = macd;
  const i = macdLine.length - 1;

  // Volume verification
  const volEMA = calcEMA(volumes, 20);
  if (volumes[volumes.length - 1] < volEMA[volEMA.length - 1]) return null;

  if (macdLine[i - 1] < signalLine[i - 1] && macdLine[i] > signalLine[i]) return 'LONG';
  if (macdLine[i - 1] > signalLine[i - 1] && macdLine[i] < signalLine[i]) return 'SHORT';
  return null;
}

/* ── Strategy 3: Scalping (Fast Cross) ──────────────────── */
function signalScalping(closes, volumes) {
  const ema9  = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const i = ema9.length - 1;

  if (ema9[i - 1] < ema21[i - 1] && ema9[i] > ema21[i]) return 'LONG';
  if (ema9[i - 1] > ema21[i - 1] && ema9[i] < ema21[i]) return 'SHORT';
  return null;
}

/* ── News & Sentiment Engine ────────────────────────────── */
async function fetchMarketNews() {
  try {
    // Using a public crypto news feed (Aggregated)
    const res = await fetchWithTimeout(`https://cryptopanic.com/api/v1/posts/?public=true`, {}, 8000);
    const data = await res.json();
    if (!data.results) return [];
    return data.results.slice(0, 10).map(p => p.title);
  } catch (e) {
    log('News Fetch error:', e.message);
    return [];
  }
}

/* ── Strategy 4: Deep AI (Gemini 24h + News Intelligence) ─ */
async function signalDeepAI(symbol, candles, news = []) {
  if (!GEMINI_KEY) {
    log('❌ Gemini Key Missing');
    return null;
  }
  
  const recent = candles.slice(-24);
  const open = recent[0][1];
  const close = recent[recent.length-1][4];
  const high = Math.max(...recent.map(c => parseFloat(c[2])));
  const low = Math.min(...recent.map(c => parseFloat(c[3])));
  const prices = recent.map(c => parseFloat(c[4])).slice(-10).join(', ');
  const recentNews = news.join(' | ');

  const prompt = `
You are an autonomous Crypto Trading AI. Analyze this combo for ${symbol}:
TECH DATA: Open ${open}, Close ${close}, High ${high}, Low ${low}. Recent Prices: [${prices}].
NEWS HEADLINES: ${recentNews || 'No major news found.'}

TASK:
1. If news is extremely negative/scandalous for this coin, reply: EXIT.
2. If news + technicals are strong bull, reply: LONG.
3. If news + technicals are strong bear, reply: SHORT.
4. Otherwise, reply: HOLD.

Reply ONLY one word: LONG, SHORT, EXIT, or HOLD.
`;

  try {
    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 10 }
      })
    }, 10000);
    
    const json = await res.json();
    const reply = json.candidates[0].content.parts[0].text.trim().toUpperCase();
    log(`🧠 AI Verdict for ${symbol}:`, reply);
    return reply;
  } catch (e) {
    log('Gemini Deep AI error:', e.message);
    return null;
  }
}

/* ── Autonomous Market Verdict (The Brain) ───────────────── */
async function getAutonomousVerdict() {
  broadcastStatus(true, "🧠 AI Analyzing Global News...");
  const news = await fetchMarketNews();
  
  broadcastStatus(true, "📡 AI Scanning Market Stats...");
  const stats = await getTopVolumeCoins(20);
  const coinList = stats.map(s => `${s.symbol} (24h: ${s.change}%, Vol: $${(s.volume/1000000).toFixed(1)}M)`).join(', ');
  
  broadcastStatus(true, "🧪 AI Analyzing Momentum...");
  
  const prompt = `
Analyze these top 20 crypto coins and their 24h momentum: ${coinList}.
Latest Market News: ${news.join(' | ')}.

TASK: Identify the SINGLE best coin for an immediate breakout trade.
Guidelines:
1. Low-Volatility pairs should be ignored.
2. If news is positive and price is up >2%, look for LONG.
3. If news is negative and price is down >2%, look for SHORT.
4. BE EAGER. We want to trade!

Answer format: SYMBOL:DIRECTION (e.g. BTCUSDT:LONG). If no viable setup, reply: NONE.
`;
  
  try {
    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 10 }
      })
    }, 8000);
    const json = await res.json();
    if (!json.candidates || !json.candidates[0].content.parts[0].text) return { coin: null, news };
    
    let reply = json.candidates[0].content.parts[0].text.trim().toUpperCase();
    reply = reply.replace(/[^A-Z:]/g, ''); 

    if (reply.includes(':')) {
      const [coin, dir] = reply.split(':');
      
      // FINAL HYBRID CHECK FOR AUTONOMOUS BRAIN
      const candles = await getCandles(coin, '5m', 50);
      const closes = candles.map(c => parseFloat(c[4]));
      const techSignal = signalRsiEma(closes, []);
      
      if (techSignal !== dir) {
        log(`🧠 AI Brain rejected by Technical Filter for ${coin} (${dir} vs Tech:${techSignal})`);
        return { coin: null, news };
      }
      
      broadcastStatus(true, `🎯 AI Verdict: ${coin} ${dir}`);
      log('🧠 Deep Intelligence Selection:', coin, dir);
      return { coin, direction: dir, news };
    }

    broadcastStatus(true, "🧪 AI: No high-conviction signals.");
    return { coin: null, news };
  } catch (e) {
    log('Brain Verdict error:', e.message);
    broadcastStatus(true, "⚠️ AI Processing Error");
    return { coin: null, news: [] };
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
  const leverage   = parseInt(TRADE_SETTINGS.leverage || 20);
  const slPctInput = parseFloat(TRADE_SETTINGS.stopLoss   || 0.5);
  const slPct      = (isNaN(slPctInput) || slPctInput <= 0 ? 0.5 : slPctInput) / 100;
  const tpPctInput = parseFloat(TRADE_SETTINGS.takeProfit || 1.0);
  const tpPct      = (isNaN(tpPctInput) || tpPctInput <= 0 ? 1.0 : tpPctInput) / 100;
  const trailPct   = parseFloat(TRADE_SETTINGS.trailingSl || 0)   / 100;

  if (slPctInput <= 0) log('⚠️ Invalid StopLoss detected. Applied 2% Safety Fallback.');

  let amount = parseFloat(TRADE_SETTINGS.amount || 50);

  // Auto-Risk (50% Balance) Logic
  if (TRADE_SETTINGS.autoRisk) {
    try {
      const balance = await getBalance();
      amount = parseFloat((balance * 0.5).toFixed(2));
      if (amount < 5) amount = 5; // Safety minimum
      log('🛡️ Auto-Risk Applied (50%):', `Margin $${amount} (Balance: $${balance})`);
    } catch (e) {
      log('⚠️ Auto-Risk failed:', e.message);
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
      if (e.message.includes('notional')) cleanMsg = "Min Notional Error ($10 min required)";
      if (e.message.includes('API-key'))   cleanMsg = "Check API Keys/IP Restrictions";
      
      broadcastStatus(true, `❌ ORDER ERROR: ${cleanMsg}`);
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
    openedAt: Date.now(),
    pnl:      0,
    pnlPct:   0
  };

  await chrome.storage.local.set({ activeTrade: ACTIVE_TRADE });
  IDLE_SCAN_COUNT = 0; // Reset after successful trade
  
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

  log(`🔄 Attempting to close trade: ${t.symbol} (${reason})`);

  if (t.mode === 'LIVE' && API_KEY && API_SECRET) {
    try {
      await cancelAllOpenOrders(t.symbol); 
      const reverseDir = t.direction === 'LONG' ? 'SHORT' : 'LONG';
      await placeMarketOrder(t.symbol, reverseDir, t.qty);
      log('✅ Binance exit order successful');
    } catch (e) {
      log('❌ Live close failed (Network/API):', e.message);
      // We DO NOT clear the local state here, so the user can retry manual close.
      throw new Error('Exchange close failed: ' + e.message);
    }
  }

  // Safety: ensure exitPrice is always a valid number
  if (!exitPrice || isNaN(exitPrice) || exitPrice <= 0) {
    exitPrice = t.markPrice || t.entry;
    log('⚠️ Invalid exitPrice - falling back to markPrice:', exitPrice);
  }

  // Final PnL calculation
  const pnlPct = t.direction === 'LONG' ? (exitPrice - t.entry) / t.entry : (t.entry - exitPrice) / t.entry;
  const pnl = parseFloat((pnlPct * t.amount * t.leverage).toFixed(2));

  const finishedTrade = {
    ...t,
    exit: parseFloat(exitPrice).toFixed(2),
    pnl,
    reason,
    closeTime: new Date().toLocaleTimeString()
  };

  // State clearing happens ONLY after success
  ACTIVE_TRADE = null;
  await chrome.storage.local.remove('activeTrade');
  
  // ── Auto-Switch Strategy on Loss (and all other reasons if enabled) ──
  const now = Date.now();
  const shouldSwitch = (reason === 'STOP_LOSS' || reason === 'STRATEGY_REVERSAL') && TRADE_SETTINGS.autoSwitch;
  
  if (shouldSwitch) {
    if (now < STRATEGY_LOCKED_UNTIL) {
       log('🛡️ Auto-Switch BLOCKED: Strategy is currently locked by user manual selection.');
    } else if (now - LAST_SWITCH_TIME > 60000) { 
       LAST_SWITCH_TIME = now;
       const currentIndex = STRATEGY_LIST.indexOf(t.strategy);
       const nextIndex = (currentIndex + 1) % STRATEGY_LIST.length;
       const newStrategy = STRATEGY_LIST[nextIndex];
       log('🔄 AUTO-SWITCHING STRATEGY:', `${t.strategy} -> ${newStrategy}`);
       STRATEGY = newStrategy;
       chrome.storage.local.set({ selectedStrategy: newStrategy });
       chrome.runtime.sendMessage({ action: 'STRATEGY_CHANGED', newStrategy });
    }
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
  const params = `timestamp=${Date.now() + TIME_OFFSET}&recvWindow=10000`;
  const sig    = await sign(params);
  const url    = `${BASE_URL()}${path}?${params}&signature=${sig}`;
  const res    = await fetchWithTimeout(url, { headers: { 'X-MBX-APIKEY': API_KEY } }, 7000);
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
  const res = await fetchWithTimeout(url, {}, 5000);
  if (!res.ok) throw new Error(`Klines HTTP ${res.status}`);
  return res.json();
}

async function getTickerPrice(symbol) {
  const url = `${BASE_URL()}/fapi/v1/ticker/price?symbol=${symbol}`;
  const res = await fetchWithTimeout(url, {}, 5000);
  if (!res.ok) throw new Error(`Ticker HTTP ${res.status}`);
  const json = await res.json();
  return parseFloat(json.price);
}

async function setLeverage(symbol, leverage) {
  const path   = '/fapi/v1/leverage';
  const params = `symbol=${symbol}&leverage=${leverage}&timestamp=${Date.now() + TIME_OFFSET}`;
  const sig    = await sign(params);
  const body   = `${params}&signature=${sig}`;
  await fetchWithTimeout(`${BASE_URL()}${path}`, {
    method: 'POST', headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  }, 5000);
}

async function refreshSymbolRules(symbol) {
  try {
    const res = await fetchWithTimeout(`${BASE_URL()}/fapi/v1/exchangeInfo`, {}, 10000);
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
  const params = `timestamp=${Date.now() + TIME_OFFSET}`;
  const sig = await sign(params);
  const res = await fetchWithTimeout(`${BASE_URL()}${path}?${params}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': API_KEY }
  }, 7000);
  if (!res.ok) return false;
  const json = await res.json();
  return json.dualSidePosition; // true if Hedge Mode
}

async function placeMarketOrder(symbol, side, qty) {
  const path = '/fapi/v1/order';
  const binSide = side === 'LONG' ? 'BUY' : 'SELL';
  const params = `symbol=${symbol}&side=${binSide}&type=MARKET&quantity=${qty}&timestamp=${Date.now() + TIME_OFFSET}`;
  const sig = await sign(params);
  const res = await fetchWithTimeout(`${BASE_URL()}${path}`, {
    method: 'POST', headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `${params}&signature=${sig}`
  }, 8000);
  if (!res.ok) { const e = await res.json(); throw new Error(e.msg || res.status); }
  return res.json();
}

async function placeProtectionOrder(symbol, side, type, stopPrice) {
  const path = '/fapi/v1/order';
  const params = `symbol=${symbol}&side=${side}&type=${type}&stopPrice=${stopPrice}&closePosition=true&timestamp=${Date.now() + TIME_OFFSET}`;
  const sig = await sign(params);
  const res = await fetchWithTimeout(`${BASE_URL()}${path}`, {
    method: 'POST', headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `${params}&signature=${sig}`
  }, 8000);
  if (!res.ok) { log(`Protection order ${type} error`, await res.json()); }
}

async function cancelAllOpenOrders(symbol) {
  const path = '/fapi/v1/allOpenOrders';
  const params = `symbol=${symbol}&timestamp=${Date.now() + TIME_OFFSET}`;
  const sig = await sign(params);
  await fetchWithTimeout(`${BASE_URL()}${path}?${params}&signature=${sig}`, {
    method: 'DELETE', headers: { 'X-MBX-APIKEY': API_KEY }
  }, 7000);
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

/* ── Fetch with Timeout ────────────────────────────────── */
async function fetchWithTimeout(resource, options = {}, timeout = 6000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal
  });
  clearTimeout(id);
  return response;
}

/* ── Broadcast helpers ──────────────────────────────────── */
function broadcastStatus(running, customMsg = null) {
  const statusText = customMsg || (running ? 'Bot Online' : 'Bot Offline');
  chrome.runtime.sendMessage({ 
    action: 'BOT_STATUS', 
    running, 
    strategy: STRATEGY,
    statusText,
    lastScan: Date.now()
  }).catch(() => {});
  // Push small log for the dashboard sidebar
  chrome.runtime.sendMessage({ action: 'DIAG_LOG', text: statusText }).catch(() => {});
}

/* ── Shuffle Helper ─────────────────────────────────────── */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

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
  if (alarm.name === 'bot-tick') {
     const data = await chrome.storage.local.get(['botRunning', 'selectedStrategy', 'savedSettings']);
     if (data.botRunning) {
        BOT_RUNNING = true;
        STRATEGY = data.selectedStrategy || STRATEGY;
        TRADE_SETTINGS = data.savedSettings || TRADE_SETTINGS;
        await loadKeys();
        if (TIME_OFFSET === 0) await syncWithBinanceTime();
        await runCycle();
     }
  }
});
chrome.alarms.create('bot-tick', { periodInMinutes: 1 });

/* ── On SW startup: restore state ───────────────────────── */
chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get(['botRunning', 'selectedStrategy', 'savedSettings']);
  if (data.botRunning) {
    await loadKeys();
    STRATEGY = data.selectedStrategy || 'RSI+EMA';
    TRADE_SETTINGS = data.savedSettings || {};
    await syncWithBinanceTime();
    await startBot();
  }
});

/* ── Sync with Binance Time ─────────────────────────────── */
async function syncWithBinanceTime() {
  try {
    const start = Date.now();
    const res = await fetch(`${BASE_URL()}/fapi/v1/time`);
    const json = await res.json();
    const end = Date.now();
    const serverTime = json.serverTime;
    // Calculate offset: ServerTime - LocalTime (using average latency)
    const latency = (end - start) / 2;
    TIME_OFFSET = serverTime - (start + latency);
    log(`🕒 Time Synced. Offset: ${TIME_OFFSET}ms`);
  } catch (e) {
    log('⚠️ Time Sync Failed:', e.message);
  }
}
async function getTicker24h(symbol) {
  try {
    const res = await fetchWithTimeout(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`, {}, 5000);
    return await res.json();
  } catch (e) {
    return null;
  }
}
