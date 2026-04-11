/**
 * FUTURES AI | Automated License & Payment Server
 * High-precision server logic to handle payments and hardware-locked keys.
 */

const axios = require('axios'); // For API calls
const crypto = require('crypto'); // For key generation

const WALLET_ADDRESS = "0x9d35215728112c055c8d2472560d7e3ec58df135";
const USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
const BSCSCAN_API_KEY = "YOUR_BSCSCAN_API_KEY"; // User must provide
const PROMO_PRICE = 12; // $12 USDT
const REGULAR_PRICE = 24; // $24 USDT

// Simple In-Memory Database (In Production, use Firestore/MongoDB)
let DB = {
    licenses: {}, // key -> { deviceId, expiry, status }
    orders: {}    // txHash -> { amount, date }
};

/**
 * 1. Payment Verification Logic
 * Scans the blockchain for recent USDT transfers to the wallet.
 */
async function verifyPayment(txHash) {
    if (DB.orders[txHash]) return { ok: false, msg: "Payment already used." };

    try {
        const url = `https://api.bscscan.com/api?module=account&action=tokentx&address=${WALLET_ADDRESS}&contractaddress=${USDT_CONTRACT}&sort=desc&apikey=${BSCSCAN_API_KEY}`;
        const res = await axios.get(url);
        const txs = res.data.result;

        const tx = txs.find(t => t.hash.toLowerCase() === txHash.toLowerCase());

        if (!tx) return { ok: false, msg: "Transaction not found on BSC." };
        
        // Amount check (dividing by 10^18 for USDT decimals)
        const amount = parseFloat(tx.value) / 1000000000000000000;
        
        if (amount < PROMO_PRICE) return { ok: false, msg: `Insufficient amount. Need at least $${PROMO_PRICE}.` };

        // Success! Generate Key
        const newKey = generateSecureKey();
        DB.licenses[newKey] = {
            deviceId: null, // To be bound on first use
            expiry: Date.now() + (30 * 24 * 3600000), // 30 days
            status: 'active',
            txHash: tx.hash
        };
        DB.orders[txHash] = { amount, date: Date.now() };

        return { ok: true, key: newKey };

    } catch (e) {
        return { ok: false, msg: "Blockchain sync error." };
    }
}

/**
 * 2. License Validation Logic
 * Called by the Trading Bot on startup.
 */
function validateLicense(key, deviceId) {
    const lic = DB.licenses[key];
    if (!lic) return { valid: false, msg: "License key does not exist." };
    if (lic.status !== 'active') return { valid: false, msg: "License has been blocked." };
    if (Date.now() > lic.expiry) return { valid: false, msg: "License has expired." };

    // Hardware Lock Check
    if (!lic.deviceId) {
        // First activation! Bind to this device
        lic.deviceId = deviceId;
        return { valid: true, msg: "License activated on this device." };
    }

    if (lic.deviceId !== deviceId) {
        return { valid: false, msg: "This key is locked to another device." };
    }

    return { valid: true, msg: "Authentication successful." };
}

/**
 * Helper: Secure Key Gen
 */
function generateSecureKey() {
    return 'BOT-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Exporting logic for use in an Express/Fastify server
module.exports = { verifyPayment, validateLicense };
