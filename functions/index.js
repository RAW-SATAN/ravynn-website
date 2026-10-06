const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();

// ── PhonePe config (set via: firebase functions:config:set phonepe.merchant_id="X" phonepe.salt_key="X" phonepe.salt_index="1") ──
const PHONEPE_CONFIG = () => functions.config().phonepe || {};
const PHONEPE_URL = 'https://api.phonepe.com/apis/hermes/pg/v1/pay';
const PHONEPE_STATUS_URL = 'https://api.phonepe.com/apis/hermes/pg/v1/status';
const SITE_URL = 'https://raw-satan.github.io/ravynn-website';

// ── CORS headers ─────────────────────────────────────────────
const cors = (res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
};

// ── Initiate PhonePe Payment ─────────────────────────────────
// Called by checkout.html when user clicks "Pay with PhonePe"
exports.initiatePayment = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { amount, orderId, phone, name } = req.body;
    const cfg = PHONEPE_CONFIG();

    if (!cfg.merchant_id || !cfg.salt_key) {
      res.status(500).json({ error: 'PhonePe not configured. Run: firebase functions:config:set phonepe.merchant_id="X" phonepe.salt_key="X" phonepe.salt_index="1"' });
      return;
    }

    const txnId = 'RAVYNN' + orderId;
    const amountPaise = Math.round(Number(amount) * 100);

    const payload = {
      merchantId: cfg.merchant_id,
      merchantTransactionId: txnId,
      merchantUserId: 'MUID' + phone,
      amount: amountPaise,
      redirectUrl: `${SITE_URL}/payment-status.html?txn=${txnId}&order=${orderId}`,
      redirectMode: 'REDIRECT',
      callbackUrl: `https://us-central1-ravynn-orders.cloudfunctions.net/paymentCallback`,
      mobileNumber: phone ? String(phone).replace(/\D/g, '').slice(-10) : undefined,
      paymentInstrument: { type: 'PAY_PAGE' }
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const saltIndex = cfg.salt_index || '1';
    const checksum = crypto.createHash('sha256')
      .update(base64Payload + '/pg/v1/pay' + cfg.salt_key)
      .digest('hex') + '###' + saltIndex;

    const response = await axios.post(
      PHONEPE_URL,
      { request: base64Payload },
      { headers: { 'Content-Type': 'application/json', 'X-VERIFY': checksum } }
    );

    const redirectUrl = response.data?.data?.instrumentResponse?.redirectInfo?.url;
    if (!redirectUrl) {
      console.error('PhonePe response:', JSON.stringify(response.data));
      res.status(502).json({ error: 'PhonePe did not return redirect URL', detail: response.data });
      return;
    }

    // Save pending order to Firestore
    await db.collection('orders').doc(orderId).set({
      orderId,
      phonePeTxnId: txnId,
      paymentStatus: 'pending',
      paymentMethod: 'phonepe',
      amount: Number(amount),
      customer: { name, phone },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({ success: true, redirectUrl, txnId });

  } catch (err) {
    console.error('initiatePayment error:', err?.response?.data || err.message);
    res.status(500).json({ error: err.message, detail: err?.response?.data });
  }
});

// ── Server-to-Server Callback from PhonePe ───────────────────
// PhonePe calls this after payment; we verify and update Firestore
exports.paymentCallback = functions.https.onRequest(async (req, res) => {
  cors(res);
  try {
    const { response: encodedResponse } = req.body;
    if (!encodedResponse) { res.status(400).send('Bad request'); return; }

    const cfg = PHONEPE_CONFIG();
    const xVerify = req.headers['x-verify'];
    const [hash, saltIndex] = (xVerify || '').split('###');
    const expectedHash = crypto.createHash('sha256')
      .update(encodedResponse + cfg.salt_key)
      .digest('hex');

    if (hash !== expectedHash) {
      console.warn('PhonePe callback hash mismatch');
      res.status(401).send('Unauthorized');
      return;
    }

    const decoded = JSON.parse(Buffer.from(encodedResponse, 'base64').toString());
    const txnId = decoded?.data?.merchantTransactionId;
    const status = decoded?.data?.responseCode === 'SUCCESS' ? 'paid' : 'failed';

    if (txnId) {
      const orderId = txnId.replace('RAVYNN', '');
      await db.collection('orders').doc(orderId).update({
        paymentStatus: status,
        status: status === 'paid' ? 'confirmed' : 'cancelled',
        phonePeResponse: decoded?.data,
        paidAt: status === 'paid' ? admin.firestore.FieldValue.serverTimestamp() : null
      });
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('paymentCallback error:', err.message);
    res.status(500).send('Error');
  }
});

// ── Verify Payment Status ─────────────────────────────────────
// Called by payment-status.html to check if payment succeeded
exports.verifyPayment = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const { txnId, orderId } = req.query;
  if (!txnId) { res.status(400).json({ error: 'txnId required' }); return; }

  try {
    const cfg = PHONEPE_CONFIG();
    const endpoint = `/pg/v1/status/${cfg.merchant_id}/${txnId}`;
    const checksum = crypto.createHash('sha256')
      .update(endpoint + cfg.salt_key)
      .digest('hex') + '###' + (cfg.salt_index || '1');

    const response = await axios.get(
      `${PHONEPE_STATUS_URL}/${cfg.merchant_id}/${txnId}`,
      { headers: { 'Content-Type': 'application/json', 'X-VERIFY': checksum, 'X-MERCHANT-ID': cfg.merchant_id } }
    );

    const success = response.data?.data?.responseCode === 'SUCCESS' || response.data?.code === 'PAYMENT_SUCCESS';

    if (success && orderId) {
      await db.collection('orders').doc(orderId).update({
        paymentStatus: 'paid',
        status: 'confirmed',
        phonePeResponse: response.data?.data,
        paidAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.json({
      success,
      code: response.data?.code,
      state: response.data?.data?.state,
      amount: response.data?.data?.amount,
      txnId
    });

  } catch (err) {
    console.error('verifyPayment error:', err?.response?.data || err.message);
    // Fall back to Firestore check
    if (orderId) {
      const doc = await db.collection('orders').doc(orderId).get();
      if (doc.exists) {
        const d = doc.data();
        res.json({ success: d.paymentStatus === 'paid', fallback: true });
        return;
      }
    }
    res.status(500).json({ error: err.message });
  }
});
