const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

// CONFIG
const WALLET_ADDRESS = "0x9d35215728112c055c8d2472560d7e3ec58df135";
const USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
const BSCSCAN_API_KEY = "YOUR_BSCSCAN_API_KEY"; // User to provide 
const PROMO_PRICE = 12; // $12 USDT (50% off)

/**
 * 1. Payment Verification (API)
 * URL: https://[REGION]-[PROJECT-ID].cloudfunctions.net/verifyPayment
 */
exports.verifyPayment = functions.https.onCall(async (data, context) => {
  const { txHash } = data;
  if (!txHash) throw new functions.https.HttpsError('invalid-argument', 'TX Hash required.');

  // Check if TX already used
  const orderSnap = await db.collection('orders').doc(txHash).get();
  if (orderSnap.exists) {
    return { ok: false, msg: "Payment already verified and used." };
  }

  try {
    const url = `https://api.bscscan.com/api?module=account&action=tokentx&address=${WALLET_ADDRESS}&contractaddress=${USDT_CONTRACT}&sort=desc&apikey=${BSCSCAN_API_KEY}`;
    const res = await axios.get(url);
    const txs = res.data.result;

    const tx = txs.find(t => t.hash.toLowerCase() === txHash.toLowerCase());

    if (!tx) return { ok: false, msg: "Transaction not found on BSC. Please wait 1-2 mins." };
    
    const amount = parseFloat(tx.value) / 1000000000000000000;
    
    if (amount < PROMO_PRICE) return { ok: false, msg: `Insufficient amount. Received: $${amount}` };

    // SUCCESS - Generate License
    const newKey = 'BOT-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    
    await db.runTransaction(async (t) => {
      // Create License
      t.set(db.collection('licenses').doc(newKey), {
        deviceId: null,
        expiry: Date.now() + (30 * 24 * 3600000), // 30 days
        status: 'active',
        txHash: tx.hash,
        createdAt: Date.now()
      });
      // Mark Order as Paid
      t.set(db.collection('orders').doc(txHash), {
        amount,
        date: Date.now(),
        licenseKey: newKey
      });
    });

    return { ok: true, key: newKey };

  } catch (e) {
    console.error("Payment Verification Error:", e);
    throw new functions.https.HttpsError('internal', 'Blockchain sync error.');
  }
});

/**
 * 2. License Validation (API for Bot)
 */
exports.validateLicense = functions.https.onCall(async (data, context) => {
  const { key, deviceId } = data;
  if (!key || !deviceId) throw new functions.https.HttpsError('invalid-argument', 'Key and DeviceID required.');

  const licRef = db.collection('licenses').doc(key);
  const licSnap = await licRef.get();

  if (!licSnap.exists) return { valid: false, msg: "License key does not exist." };
  
  const lic = licSnap.data();
  if (lic.status !== 'active') return { valid: false, msg: "License has been blocked." };
  if (Date.now() > lic.expiry) return { valid: false, msg: "License has expired." };

  // Hardware Lock Check
  if (!lic.deviceId) {
    await licRef.update({ deviceId });
    return { valid: true, msg: "License activated on this device." };
  }

  if (lic.deviceId !== deviceId) {
    return { valid: false, msg: "This key is locked to another device." };
  }

  return { valid: true, msg: "Authentication successful." };
});
