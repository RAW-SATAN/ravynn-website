const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();

const SITE_URL = 'https://raw-satan.github.io/ravynn-website';

// PhonePe v2 API endpoints
const PP_AUTH_PROD   = 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token';
const PP_AUTH_SBX    = 'https://api-preprod.phonepe.com/apis/identity-manager/v1/oauth/token';
const PP_PAY_PROD    = 'https://api.phonepe.com/apis/pg/checkout/v2/pay';
const PP_PAY_SBX     = 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay';
const PP_STATUS_PROD = 'https://api.phonepe.com/apis/pg/checkout/v2/order';
const PP_STATUS_SBX  = 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order';

const cfg = () => functions.config().phonepe || {};
const sandbox = () => cfg().sandbox === 'true';

// In-memory token cache (per function instance)
let _tok = null;

async function getToken() {
  const now = Date.now();
  if (_tok && _tok.exp > now + 60000) return _tok.val;

  const c = cfg();
  if (!c.client_id || !c.client_secret) {
    throw new Error('PhonePe not configured. Run: firebase functions:config:set phonepe.client_id="X" phonepe.client_secret="X" phonepe.client_version="1"');
  }

  const params = new URLSearchParams({
    client_id: c.client_id,
    client_secret: c.client_secret,
    grant_type: 'client_credentials',
    client_version: c.client_version || '1'
  });

  const resp = await axios.post(sandbox() ? PP_AUTH_SBX : PP_AUTH_PROD, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  _tok = { val: resp.data.access_token, exp: now + (resp.data.expires_in * 1000) };
  return _tok.val;
}

const cors = (res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
};

// ── 1. Initiate Payment ───────────────────────────────────────
exports.initiatePayment = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { amount, orderId, phone, name } = req.body;
    const merchantOrderId = 'RAVYNN' + orderId;
    const amountPaise = Math.round(Number(amount) * 100);

    const token = await getToken();

    const payload = {
      merchantOrderId,
      amount: amountPaise,
      expireAfter: 1200,
      metaInfo: { udf1: phone || '', udf2: name || '', udf3: orderId },
      paymentFlow: {
        type: 'PG_CHECKOUT',
        message: `RAVYNN Order #${orderId}`,
        merchantUrls: {
          redirectUrl: `${SITE_URL}/payment-status.html?txn=${merchantOrderId}&order=${orderId}`
        }
      }
    };

    const response = await axios.post(
      sandbox() ? PP_PAY_SBX : PP_PAY_PROD,
      payload,
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
    );

    const redirectUrl = response.data?.redirectUrl;
    if (!redirectUrl) {
      console.error('PhonePe no redirectUrl:', JSON.stringify(response.data));
      res.status(502).json({ error: 'No redirect URL from PhonePe', detail: response.data });
      return;
    }

    await db.collection('orders').doc(orderId).set({
      orderId,
      phonePeTxnId: merchantOrderId,
      paymentStatus: 'pending',
      paymentMethod: 'phonepe',
      amount: Number(amount),
      customer: { name, phone },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({ success: true, redirectUrl, txnId: merchantOrderId });

  } catch (err) {
    console.error('initiatePayment:', err?.response?.data || err.message);
    res.status(500).json({ error: err.message, detail: err?.response?.data });
  }
});

// ── 2. Webhook (checkout.order.completed) ────────────────────
exports.paymentCallback = functions.https.onRequest(async (req, res) => {
  cors(res);
  try {
    const body = req.body;
    const c = cfg();

    // Verify HMAC-SHA256 signature
    const sig = req.headers['x-phonepe-signature'] || req.headers['x-verify'] || '';
    if (c.client_secret && sig) {
      const expected = crypto.createHmac('sha256', c.client_secret)
        .update(JSON.stringify(body))
        .digest('hex');
      if (sig !== expected) {
        console.warn('Webhook signature mismatch');
        res.status(401).send('Unauthorized');
        return;
      }
    }

    if (body.event === 'checkout.order.completed') {
      const p = body.payload || {};
      const merchantOrderId = p.merchantOrderId || '';
      const orderId = merchantOrderId.replace(/^RAVYNN/, '');
      const status = p.state === 'COMPLETED' ? 'paid' : 'failed';

      if (orderId) {
        await db.collection('orders').doc(orderId).update({
          paymentStatus: status,
          status: status === 'paid' ? 'confirmed' : 'cancelled',
          phonePeState: p.state,
          phonePeResponse: p,
          paidAt: status === 'paid' ? admin.firestore.FieldValue.serverTimestamp() : null
        });
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('paymentCallback:', err.message);
    res.status(500).send('Error');
  }
});

// ── 3. Verify Payment (polled by payment-status.html) ────────
exports.verifyPayment = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const { txnId, orderId } = req.query;
  if (!txnId) { res.status(400).json({ error: 'txnId required' }); return; }

  try {
    const token = await getToken();
    const baseUrl = sandbox() ? PP_STATUS_SBX : PP_STATUS_PROD;

    const response = await axios.get(`${baseUrl}/${txnId}/status`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });

    const state   = response.data?.state || '';
    const success = state === 'COMPLETED';

    if (success && orderId) {
      await db.collection('orders').doc(orderId).update({
        paymentStatus: 'paid',
        status: 'confirmed',
        phonePeState: state,
        phonePeResponse: response.data,
        paidAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.json({ success, state, amount: response.data?.amount, txnId });

  } catch (err) {
    console.error('verifyPayment:', err?.response?.data || err.message);
    // Fallback: check Firestore
    if (orderId) {
      try {
        const doc = await db.collection('orders').doc(orderId).get();
        if (doc.exists) {
          const d = doc.data();
          res.json({ success: d.paymentStatus === 'paid', fallback: true });
          return;
        }
      } catch (_) {}
    }
    res.status(500).json({ error: err.message });
  }
});
