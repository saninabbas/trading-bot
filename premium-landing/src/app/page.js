"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ShieldCheck, 
  Zap, 
  LineChart, 
  Lock, 
  Cpu, 
  Smartphone, 
  Activity, 
  AlertTriangle,
  PlayCircle,
  Menu,
  X,
  Star,
  ChevronDown
} from 'lucide-react';

/* --- DATA --- */
const BADGES = [
  "Secure Payment", "Binance Compatible", "AI Powered", 
  "Smart Risk Control", "Premium Support", "24/7 Running"
];

const FEATURES = [
  { title: "Smart Coin Scanner", icon: <LineChart className="text-gold-500 w-8 h-8"/>, desc: "Scans 300+ coins per minute to identify 65%+ conviction setups using advanced AI metrics." },
  { title: "50% Capital Rule", icon: <ShieldCheck className="text-gold-500 w-8 h-8"/>, desc: "Never risks your entire balance. Only utilizes 50% max margin for ultra-safe trading." },
  { title: "Profit Lock System", icon: <Lock className="text-gold-500 w-8 h-8"/>, desc: "Trailling Take Profit secures gains automatically before trend reversals occur." },
  { title: "Auto Stop Target", icon: <AlertTriangle className="text-gold-500 w-8 h-8"/>, desc: "Dynamically calculates and places strict stop losses on every trade." },
  { title: "One Device License", icon: <Smartphone className="text-gold-500 w-8 h-8"/>, desc: "Hardware-locked military grade security. Your exclusive key belongs only to you." },
  { title: "Live Dashboard", icon: <Activity className="text-gold-500 w-8 h-8"/>, desc: "Real-time PnL, active trades tracking, and diagnostic background logs." },
  { title: "Fast Execution", icon: <Zap className="text-gold-500 w-8 h-8"/>, desc: "Serverless Vercel API executes trades instantly on Binance servers." },
  { title: "Safe Risk Logic", icon: <Cpu className="text-gold-500 w-8 h-8"/>, desc: "Avoids high-volatility news spikes and focuses only on high-edge technical setups." }
];

const STEPS = [
  { num: "01", title: "Buy License Key", text: "Select your plan and proceed to secure checkout." },
  { num: "02", title: "Pay 24 USDT", text: "Send precisely 12 USDT (promo) on the BEP20 network." },
  { num: "03", title: "Receive Key Instantly", text: "Vercel backend verifies Binance scan and generates key." },
  { num: "04", title: "Activate On Device", text: "Download bot, enter key, and lock to your PC." },
  { num: "05", title: "Start Bot", text: "Input your Binance API keys and turn the Oracle on." },
  { num: "06", title: "Earn Smartly", text: "Watch the dashboard as it secures profits 24/7." }
];

const REVIEWS = [
  { name: "Alex Rivera", location: "Dubai", text: "Best auto bot I used. The interface is stunning and it literally trades while I sleep.", rating: 5 },
  { name: "Sarah Khan", location: "London", text: "Easy profit locking system. It avoids bad trades and only snipe targets with high setup scores.", rating: 5 },
  { name: "Michael Chen", location: "Singapore", text: "Very clean dashboard. The v3.0 Hedge Fund logic is seriously smart. No more manual scanning.", rating: 5 },
  { name: "Ahmed Al-Sayed", location: "Riyadh", text: "Worth every dollar. Recovered my initial $24 cost within the first 48 hours of running.", rating: 5 }
];

const FAQS = [
  { q: "Is this safe?", a: "Yes, our algorithm strictly enforces maximum limits per trade, utilizes trailing stops, and includes dynamic risk controls." },
  { q: "How do I pay?", a: "We currently accept USDT via the BEP20 (Binance Smart Chain) network. Fully automated via BscScan." },
  { q: "When do I get license key?", a: "Instantly. As soon as the blockchain confirms your transaction, our API displays your unique hardware-locked key." },
  { q: "Can one key work on two devices?", a: "No, one device only. Standard licenses are bound to a generated DeviceID for security verification." },
  { q: "Refund available?", a: "License delivered = no refund. Duplicate payment or unresolved technical issue = case-by-case review." },
  { q: "Do I need experience?", a: "No, beginner friendly. We have an &apos;Easy Mode&apos; that sets up safe parameters. You just observe." }
];

/* --- COMPONENTS --- */

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = ['Features', 'Pricing', 'Reviews', 'FAQ', 'User Guide'];
  
  return (
    <nav className="fixed w-full top-0 z-50 glass border-b border-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <div className="flex-shrink-0 flex items-center space-x-2">
            <div className="w-10 h-10 border-2 border-gold-500 rounded-lg flex items-center justify-center glow-gold">
              <Zap className="text-gold-500 w-6 h-6" />
            </div>
            <span className="font-bold text-xl tracking-wider uppercase text-white">
              AntiGravity <span className="text-gold-gradient">Bot</span>
            </span>
          </div>
          <div className="hidden md:block">
            <div className="ml-10 flex items-baseline space-x-8">
              {links.map(item => (
                <a key={item} href={`#${item.toLowerCase()}`} className="text-gray-300 hover:text-gold-400 transition-colors px-3 py-2 rounded-md text-sm font-medium uppercase tracking-wider">
                  {item}
                </a>
              ))}
            </div>
          </div>
          <div className="hidden md:flex space-x-4 items-center">
            <a href="#login" className="text-gray-300 hover:text-white transition-colors text-sm font-medium uppercase">Login</a>
            <a href="#pricing" className="bg-gold-gradient text-black font-bold px-6 py-2 rounded-md glow-gold glow-gold-hover transition-all duration-300 uppercase tracking-wider">
              Buy Now
            </a>
          </div>
          <div className="-mr-2 flex md:hidden">
            <button onClick={() => setMobileOpen(!mobileOpen)} className="text-gray-400 hover:text-white p-2">
              {mobileOpen ? <X/> : <Menu/>}
            </button>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {mobileOpen && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="md:hidden overflow-hidden bg-black border-b border-gray-900">
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
              {links.map(item => (
                <a key={item} href={`#${item.toLowerCase()}`} onClick={() => setMobileOpen(false)} className="text-gray-300 hover:text-gold-400 block px-3 py-2 rounded-md text-base font-medium">
                  {item}
                </a>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

const Hero = () => {
  return (
    <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden flex items-center min-h-[90vh]">
      {/* Background Particles Placeholder */}
      <div className="absolute inset-0 z-0 opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-gold-900 via-black to-black" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 w-full">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          
          <motion.div initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8 }}>
            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-extrabold tracking-tight mb-6">
              <span className="block text-white">AI Trading Bot That Finds</span>
              <span className="block text-gold-gradient mt-2">Profitable Coins Automatically</span>
            </h1>
            <p className="mt-4 text-xl text-gray-400 mb-8 max-w-2xl">
              Scans all coins, chooses best trade, protects profits, and trades smartly. Professional institutional logic, now available for everyone.
            </p>
            <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-6">
              <a href="#pricing" className="bg-gold-gradient text-black font-bold px-8 py-4 rounded-md text-center glow-gold glow-gold-hover transition-all duration-300 text-lg uppercase tracking-wider">
                Buy License Key
              </a>
              <a href="#features" className="border border-gray-700 text-white font-bold px-8 py-4 rounded-md text-center hover:border-gold-500 hover:text-gold-500 transition-all duration-300 flex items-center justify-center text-lg uppercase tracking-wider">
                <PlayCircle className="w-5 h-5 mr-2" /> Watch Demo
              </a>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1, delay: 0.2 }} className="relative">
            <div className="absolute -inset-1 bg-gold-gradient rounded-xl blur opacity-30 animate-pulse-slow"></div>
            <div className="relative glass p-6 rounded-xl border border-gray-800 shadow-2xl">
              {/* Dashboard Simulation */}
              <div className="flex justify-between items-center mb-6 border-b border-gray-800 pb-4">
                 <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
                    <span className="text-sm font-bold tracking-widest text-green-500 uppercase">Bot Running</span>
                 </div>
                 <div className="text-xl font-bold text-white">Total PnL: <span className="text-green-500">+$124.50</span></div>
              </div>
              
              <div className="space-y-4">
                 <div className="h-24 bg-gray-900 rounded border border-gray-800 flex flex-col justify-center px-4 relative overflow-hidden">
                    <div className="flex justify-between items-center z-10 relative">
                       <div>
                         <div className="text-gray-400 text-xs font-bold tracking-wider mb-1">LONG BTCUSDT</div>
                         <div className="text-white text-lg">Entry: $64,200</div>
                       </div>
                       <div className="text-right">
                         <div className="text-green-500 font-bold text-xl">+1.45%</div>
                         <div className="text-gray-500 text-sm">TP Active</div>
                       </div>
                    </div>
                    {/* Fake Chart Line */}
                    <svg className="absolute bottom-0 left-0 w-full h-12 opacity-50" viewBox="0 0 100 20" preserveAspectRatio="none">
                      <path d="M0,20 L10,15 L20,18 L30,5 L40,12 L50,8 L60,15 L70,2 L80,10 L90,4 L100,0" fill="none" stroke="#22c55e" strokeWidth="2"/>
                    </svg>
                 </div>
                 <div className="p-3 bg-black rounded border border-gray-800 font-mono text-xs text-gray-400 space-y-1">
                   <p className="text-green-400">[10:04:15] Global Scanner: Identifying opportunities...</p>
                   <p className="text-gold-400">[10:05:22] 💎 Best Pair Found: BTCUSDT | Score: 85%</p>
                   <p className="text-blue-400">[10:05:23] 🚀 LONG LIVE BTCUSDT @ 64,200</p>
                 </div>
              </div>
            </div>
          </motion.div>
          
        </div>
      </div>
    </section>
  );
};

const BadgesSection = () => {
  return (
    <div className="border-y border-gray-900 bg-black/50 py-8">
      <div className="max-w-7xl mx-auto px-4 overflow-hidden">
        <div className="flex flex-wrap justify-center gap-6 sm:gap-12 opacity-80">
          {BADGES.map((b, i) => (
            <motion.div key={i} whileHover={{ scale: 1.05, color: '#FFD700' }} className="flex items-center space-x-2 text-sm font-bold uppercase tracking-wider text-gray-500 cursor-default transition-colors">
              <ShieldCheck className="w-5 h-5"/> <span>{b}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Features = () => {
  return (
    <section id="features" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center mb-16">
          <h2 className="text-gold-500 font-bold tracking-widest uppercase mb-2 text-sm">Institutional Logic</h2>
          <h3 className="text-3xl md:text-5xl font-extrabold text-white">Full Stack Arsenal</h3>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {FEATURES.map((f, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once:true }} transition={{ delay: i * 0.1 }}
              className="glass p-6 rounded-xl border border-gray-800 hover:border-gold-500/50 transition-colors group cursor-default">
              <div className="mb-4 bg-gray-900 w-14 h-14 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                {f.icon}
              </div>
              <h4 className="text-lg font-bold text-white mb-2">{f.title}</h4>
              <p className="text-sm text-gray-400 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const HowItWorks = () => {
  return (
    <section id="user guide" className="py-24 bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
         <div className="text-center mb-16">
          <h2 className="text-gold-500 font-bold tracking-widest uppercase mb-2 text-sm">Quick Setup</h2>
          <h3 className="text-3xl md:text-5xl font-extrabold text-white mb-6">How It Works</h3>
          <p className="text-gray-400 max-w-2xl mx-auto">Get your bot running and executing trades in under 5 minutes.</p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {STEPS.map((s, i) => (
            <motion.div key={i} initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once:true }} transition={{ delay: i * 0.1 }}
              className="relative p-6 border border-gray-800 rounded-lg bg-black hover:border-gold-500/30 transition-all">
              <div className="text-5xl font-black text-transparent -webkit-text-stroke text-gray-800 absolute top-4 right-4" style={{WebkitTextStroke: '1px #333'}}>{s.num}</div>
              <h4 className="text-xl font-bold text-white mb-3 relative z-10">{s.title}</h4>
              <p className="text-gray-400 text-sm relative z-10">{s.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

const Pricing = () => {
  const [timeLeft, setTimeLeft] = useState(3600);
  const [showModal, setShowModal] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [status, setStatus] = useState({ loading: false, msg: '', key: null });

  const handleVerify = async () => {
    if (!txHash.trim()) { setStatus({ ...status, msg: 'TX Hash is required.' }); return; }
    setStatus({ loading: true, msg: '🔍 Checking BSC Blockchain...', key: null });
    try {
      const res = await fetch('https://trading-bot-liart.vercel.app/api/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash })
      });
      const data = await res.json();
      if (data.ok) {
        setStatus({ loading: false, msg: '✅ Payment Verified!', key: data.key });
      } else {
        setStatus({ loading: false, msg: '❌ ' + data.msg, key: null });
      }
    } catch(e) {
      setStatus({ loading: false, msg: '❌ Server Error. Try again.', key: null });
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setTimeLeft(t => t > 0 ? t - 1 : 0), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (s) => `${Math.floor(s/3600).toString().padStart(2, '0')}:${Math.floor((s%3600)/60).toString().padStart(2, '0')}:${(s%60).toString().padStart(2, '0')}`;

  return (
    <section id="pricing" className="py-24 relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-1/2 bg-gold-900/10 blur-[100px] pointer-events-none"></div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center mb-16">
          <div className="inline-block bg-red-900/50 text-red-400 px-4 py-1 rounded-full text-xs font-bold tracking-widest uppercase mb-4 animate-pulse">🔥 50% OFF Today Only</div>
          <h3 className="text-3xl md:text-5xl font-extrabold text-white mb-4">Choose Your License</h3>
          <p className="text-gold-400 font-mono text-xl mb-4">Offer Ends In: {formatTime(timeLeft)}</p>
          <p className="text-gray-400 text-sm">Only a limited amount of discounted keys remain.</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8 items-center max-w-5xl mx-auto">
          {/* Plan 1 */}
          <div className="p-8 rounded-2xl border border-gray-800 bg-[#050505]">
            <h4 className="text-xl font-bold text-white mb-2 uppercase">Pro Plan</h4>
            <div className="text-4xl font-extrabold text-white mb-6">$49 <span className="text-lg text-gray-500 font-normal line-through">$99</span></div>
            <ul className="space-y-4 mb-8 text-sm text-gray-400">
              <li className="flex items-center"><ShieldCheck className="w-4 h-4 mr-2 text-gold-500"/> Full Access</li>
              <li className="flex items-center"><ShieldCheck className="w-4 h-4 mr-2 text-gold-500"/> 2 Devices Locked</li>
              <li className="flex items-center"><ShieldCheck className="w-4 h-4 mr-2 text-gold-500"/> Priority Support</li>
            </ul>
            <button className="w-full py-3 rounded border border-gray-700 text-white font-bold hover:bg-gray-800 transition-colors">Select Plan</button>
          </div>

          {/* Plan 2: Main */}
          <motion.div whileHover={{ scale: 1.02 }} className="p-8 rounded-2xl border-2 border-gold-500 bg-black relative shadow-[0_0_40px_rgba(255,215,0,0.1)]">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gold-gradient text-black px-4 py-1 rounded-full text-xs font-bold tracking-widest uppercase">Most Popular</div>
            <h4 className="text-2xl font-bold text-gold-400 mb-2 uppercase text-center mt-2">Standard Plan</h4>
            <div className="text-5xl font-extrabold text-white mb-6 text-center">$24 <span className="text-lg text-gray-500 font-normal line-through">$48</span></div>
            <ul className="space-y-4 mb-8 text-sm text-gray-300">
              <li className="flex items-center"><ShieldCheck className="w-4 h-4 mr-2 text-gold-500"/> 100% Full Feature Access</li>
              <li className="flex items-center"><ShieldCheck className="w-4 h-4 mr-2 text-gold-500"/> 1 Device Hardware Locked</li>
              <li className="flex items-center"><ShieldCheck className="w-4 h-4 mr-2 text-gold-500"/> Hedge Fund v3.0 Logic</li>
              <li className="flex items-center"><ShieldCheck className="w-4 h-4 mr-2 text-gold-500"/> Setup Guide + Updates</li>
            </ul>
            <button onClick={() => setShowModal(true)} className="w-full py-4 rounded bg-gold-gradient text-black font-extrabold uppercase tracking-wider glow-gold-hover transition-all">Buy Standard Key</button>
          </motion.div>

          {/* Plan 3 */}
          <div className="p-8 rounded-2xl border border-gray-800 bg-[#050505]">
            <h4 className="text-xl font-bold text-white mb-2 uppercase">Lifetime Plan</h4>
            <div className="text-4xl font-extrabold text-white mb-6">$99 <span className="text-lg text-gray-500 font-normal line-through">$199</span></div>
            <ul className="space-y-4 mb-8 text-sm text-gray-400">
              <li className="flex items-center"><ShieldCheck className="w-4 h-4 mr-2 text-gold-500"/> Lifetime Keys</li>
              <li className="flex items-center"><ShieldCheck className="w-4 h-4 mr-2 text-gold-500"/> Unlimited Devices</li>
              <li className="flex items-center"><ShieldCheck className="w-4 h-4 mr-2 text-gold-500"/> VIP Support Channel</li>
            </ul>
            <button className="w-full py-3 rounded border border-gray-700 text-white font-bold hover:bg-gray-800 transition-colors">Select Plan</button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="bg-[#050505] border border-gray-800 p-6 rounded-xl max-w-md w-full relative">
              <button onClick={() => setShowModal(false)} className="absolute top-4 right-4 text-gray-500 hover:text-white"><X className="w-5 h-5"/></button>
              <h3 className="text-2xl font-bold text-white mb-4">Complete Payment</h3>
              <div className="bg-black border border-gray-900 p-4 rounded-lg mb-4 text-center">
                <p className="text-gray-400 text-sm mb-2">Send precisely <strong className="text-white">12 USDT (BEP20)</strong> to:</p>
                <div className="text-gold-500 font-mono text-sm break-all mb-2">0x9d35215728112c055c8d2472560d7e3ec58df135</div>
              </div>
              
              <p className="text-gray-400 text-sm mb-2">After sending, paste your TXID/Hash below:</p>
              <input type="text" value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="0x..." className="w-full bg-black border border-gray-800 text-white p-3 rounded mb-4 outline-none focus:border-gold-500" />
              
              <button onClick={handleVerify} disabled={status.loading} className="w-full bg-gold-gradient text-black font-bold py-3 rounded disabled:opacity-50">
                {status.loading ? 'Verifying...' : '✅ I Have Paid'}
              </button>

              {status.msg && (
                <div className="mt-4 p-4 rounded bg-gray-900 border border-gray-800">
                  <p className={`text-sm ${status.key ? 'text-green-500' : 'text-red-400'} font-bold`}>{status.msg}</p>
                  {status.key && (
                    <div className="mt-2">
                       <p className="text-xs text-gray-400 mb-1">Your License Key:</p>
                       <div className="bg-black p-2 border border-gold-500/30 text-gold-500 font-mono text-center rounded">{status.key}</div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </section>
  );
};

const Reviews = () => {
  return (
    <section id="reviews" className="py-24 bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-gold-500 font-bold tracking-widest uppercase mb-2 text-sm">Verified Buyers</h2>
          <h3 className="text-3xl md:text-5xl font-extrabold text-white">Traders Are Winning</h3>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          {REVIEWS.map((r, i) => (
            <motion.div key={i} whileHover={{ y: -5 }} className="p-6 border border-gray-800 rounded-xl bg-black">
              <div className="flex text-gold-500 mb-4">
                {[...Array(r.rating)].map((_, j) => <Star key={j} className="w-4 h-4 fill-current"/>)}
              </div>
              <p className="text-gray-300 italic mb-6">&quot;{r.text}&quot;</p>
              <div className="flex items-center justify-between border-t border-gray-900 pt-4 mt-auto">
                <div className="font-bold text-white">{r.name}</div>
                <div className="text-xs text-gray-500 uppercase tracking-widest">{r.location}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const FAQ = () => {
  const [open, setOpen] = useState(null);
  
  return (
    <section id="faq" className="py-24 relative">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h3 className="text-3xl md:text-5xl font-extrabold text-white">Questions & Answers</h3>
        </div>
        <div className="space-y-4">
          {FAQS.map((q, i) => (
            <div key={i} className="border border-gray-800 rounded-lg bg-[#050505] overflow-hidden">
              <button onClick={() => setOpen(open === i ? null : i)} className="w-full px-6 py-4 flex justify-between items-center text-left focus:outline-none">
                <span className="font-bold text-white pr-4">{q.q}</span>
                <ChevronDown className={`w-5 h-5 text-gold-500 transition-transform ${open === i ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {open === i && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="px-6 pb-4 text-gray-400 text-sm leading-relaxed">{q.a}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Footer = () => {
  return (
    <footer className="bg-black py-12 border-t border-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="flex items-center justify-center space-x-2 mb-6">
          <div className="w-8 h-8 border border-gold-500 rounded flex items-center justify-center">
            <Zap className="text-gold-500 w-4 h-4" />
          </div>
          <span className="font-bold text-lg tracking-wider uppercase text-white">
            AntiGravity <span className="text-gold-gradient">Bot</span>
          </span>
        </div>
        <div className="space-x-6 text-sm text-gray-500 mb-6 font-medium uppercase tracking-wider">
          <a href="#" className="hover:text-gold-400 transition-colors">Privacy Policy</a>
          <a href="#" className="hover:text-gold-400 transition-colors">Terms of Service</a>
          <a href="#" className="hover:text-gold-400 transition-colors">Contact</a>
        </div>
        <p className="text-gray-700 text-xs">&copy; {new Date().getFullYear()} AntiGravity Bot. High Risk Warning: Cryptocurrency trading carries a high level of risk.</p>
      </div>
    </footer>
  );
};

// Purchase Popup
const PurchasePopup = () => {
  const [pop, setPop] = useState(false);
  const names = ['Alex', 'David', 'Sarah', 'Michael', 'James', 'Elena'];
  const [person, setPerson] = useState('');
  
  useEffect(() => {
    const trigger = () => {
      setPerson(names[Math.floor(Math.random() * names.length)]);
      setPop(true);
      setTimeout(() => setPop(false), 5000); // hide after 5s
    };
    const iv = setInterval(trigger, 25000); // show every 25s
    setTimeout(trigger, 5000); // 1st trigger
    return () => clearInterval(iv);
  }, []);

  return (
    <AnimatePresence>
      {pop && (
        <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }}
          className="fixed bottom-6 right-6 z-50 glass border border-gold-500/50 p-4 rounded-lg shadow-2xl flex items-center space-x-4 max-w-sm">
          <div className="bg-green-500/20 p-2 rounded-full"><ShieldCheck className="text-green-500 w-6 h-6"/></div>
          <div>
            <p className="text-white text-sm font-bold">{person} just bought</p>
            <p className="text-gold-400 text-xs">Standard Plan • 2 mins ago</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default function Home() {
  return (
    <div className="min-h-screen relative selection:bg-gold-500/30">
      <Navbar />
      <Hero />
      <BadgesSection />
      <Features />
      <HowItWorks />
      <Pricing />
      <Reviews />
      <FAQ />
      <Footer />
      <PurchasePopup />
    </div>
  );
}
