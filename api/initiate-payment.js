import { neon } from '@neondatabase/serverless';
import axios from 'axios';

const SITE_URL = 'https://ravynn-website.vercel.app';
const SANDBOX = process.env.PHONEPE_SANDBOX === 'true';

const PP_AUTH = SANDBOX
  ? 'https://api-preprod.phonepe.com/apis/identity-manager/v1/oauth/token'
  : 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token';

const PP_PAY = SANDBOX
  ? 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay'
  : 'https://api.phonepe.com/apis/pg/checkout/v2/pay';

let _tok = null;

async function getToken() {
  const now = Date.now();
  if (_tok && _tok.exp > now + 60000) return _tok.val;

  const params = new URLSearchParams({
    client_id: process.env.PHONEPE_CLIENT_ID,
    client_secret: process.env.PHONEPE_CLIENT_SECRET,
    grant_type: 'client_credentials',
    client_version: process.env.PHONEPE_CLIENT_VERSION || '1'
  });

  const resp = await axios.post(PP_AUTH, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  _tok = { val: resp.data.access_token, exp: now + resp.data.expires_in * 1000 };
  return _tok.val;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { amount, orderId, phone, name, items } = req.body;
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

    const response = await axios.post(PP_PAY, payload, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });

    const redirectUrl = response.data?.redirectUrl;
    if (!redirectUrl) {
      return res.status(502).json({ error: 'No redirectUrl from PhonePe', detail: response.data });
    }

    // Save pending order to Neon
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      INSERT INTO orders (id, phonepe_txn_id, payment_status, amount, customer_name, customer_phone, items)
      VALUES (${orderId}, ${merchantOrderId}, 'pending', ${Number(amount)}, ${name || ''}, ${phone || ''}, ${JSON.stringify(items || [])})
      ON CONFLICT (id) DO UPDATE SET
        phonepe_txn_id = EXCLUDED.phonepe_txn_id,
        payment_status = 'pending',
        amount = EXCLUDED.amount
    `;

    return res.json({ success: true, redirectUrl, txnId: merchantOrderId });

  } catch (err) {
    console.error('initiate-payment:', err?.response?.data || err.message);
    return res.status(500).json({ error: err.message, detail: err?.response?.data });
  }
}
