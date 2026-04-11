const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Health Check (To fix the 404 you see on the main page)
app.get('/', (req, res) => {
    res.send("🚀 FUTURES AI License Server is LIVE and Running!");
});

// CONFIG
const WALLET_ADDRESS = "0x9d35215728112c055c8d2472560d7e3ec58df135";
const USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY || "YOUR_BSCSCAN_API_KEY";
const PROMO_PRICE = 12;

// DATABASE SETUP (Using your MongoDB Atlas Cluster)
const mongoURI = process.env.MONGO_URI || "mongodb+srv://saninabbas_db_user:<PASSWORD>@cluster0.b3bzeev.mongodb.net/futures_ai?retryWrites=true&w=majority";

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("Connected to MongoDB Atlas ✅"))
    .catch(err => console.error("Database Connection Error ❌", err));

// MongoDB Schemas
const License = mongoose.model('License', {
    key: String,
    deviceId: String,
    expiry: Number,
    status: String,
    txHash: String,
    createdAt: { type: Number, default: Date.now }
});

const Order = mongoose.model('Order', {
    txHash: String,
    amount: Number,
    date: { type: Number, default: Date.now }
});

/**
 * 1. Verify Payment & Generate Key
 */
app.post('/api/verify-payment', async (req, res) => {
    const { txHash } = req.body;
    if (!txHash) return res.status(400).json({ ok: false, msg: "TX Hash required." });

    try {
        // Check if TX already used
        const existingOrder = await Order.findOne({ txHash });
        if (existingOrder) return res.json({ ok: false, msg: "Payment already verified." });

        const url = `https://api.bscscan.com/api?module=account&action=tokentx&address=${WALLET_ADDRESS}&contractaddress=${USDT_CONTRACT}&sort=desc&apikey=${BSCSCAN_API_KEY}`;
        const bscRes = await axios.get(url);
        const txs = bscRes.data.result;

        const tx = txs.find(t => t.hash.toLowerCase() === txHash.toLowerCase());

        if (!tx) return res.json({ ok: false, msg: "Transaction not found on BSC. Wait 1 min." });
        
        const amount = parseFloat(tx.value) / 1000000000000000000;
        if (amount < PROMO_PRICE) return res.json({ ok: false, msg: `Insufficient amount. Received: $${amount}` });

        // Success!
        const newKey = 'BOT-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        
        await License.create({
            key: newKey,
            deviceId: null,
            expiry: Date.now() + (30 * 24 * 3600000),
            status: 'active',
            txHash: tx.hash
        });
        await Order.create({ txHash, amount });

        res.json({ ok: true, key: newKey });

    } catch (e) {
        res.status(500).json({ ok: false, msg: "Server error." });
    }
});

/**
 * 2. Validate License (API for Bot)
 */
app.post('/api/validate-license', async (req, res) => {
    const { key, deviceId } = req.body;
    if (!key || !deviceId) return res.status(400).json({ ok: false, msg: "Key/DeviceID missing." });

    try {
        const lic = await License.findOne({ key });

        if (!lic) return res.json({ valid: false, msg: "License key does not exist." });
        if (lic.status !== 'active') return res.json({ valid: false, msg: "License blocked." });
        if (Date.now() > lic.expiry) return { valid: false, msg: "License expired." };

        if (!lic.deviceId) {
            lic.deviceId = deviceId;
            await lic.save();
            return res.json({ valid: true, msg: "Activated on this device." });
        }

        if (lic.deviceId !== deviceId) {
            return res.json({ valid: false, msg: "Locked to another device." });
        }

        res.json({ valid: true, msg: "Verified." });

    } catch (e) {
        res.status(500).json({ valid: false, msg: "Auth error." });
    }
});

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`License Server running on port ${PORT} 🚀`));
}

module.exports = app;
