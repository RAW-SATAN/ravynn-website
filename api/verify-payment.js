import { neon } from '@neondatabase/serverless';
import axios from 'axios';

const SANDBOX = process.env.PHONEPE_SANDBOX === 'true';

const PP_AUTH = SANDBOX
  ? 'https://api-preprod.phonepe.com/apis/identity-manager/v1/oauth/token'
  : 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token';

const PP_STATUS = SANDBOX
  ? 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order'
  : 'https://api.phonepe.com/apis/pg/checkout/v2/order';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { txnId, orderId } = req.query;
  if (!txnId) return res.status(400).json({ error: 'txnId required' });

  try {
    const token = await getToken();

    const response = await axios.get(`${PP_STATUS}/${txnId}/status`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });

    const state = response.data?.state || '';
    const success = state === 'COMPLETED';

    if (success && orderId) {
      const sql = neon(process.env.DATABASE_URL);
      await sql`
        UPDATE orders SET
          payment_status = 'paid',
          phonepe_state = ${state},
          paid_at = ${new Date().toISOString()}
        WHERE id = ${orderId}
      `;
    }

    return res.json({ success, state, amount: response.data?.amount, txnId });

  } catch (err) {
    console.error('verify-payment:', err?.response?.data || err.message);

    // Fallback: check Neon directly
    if (orderId) {
      try {
        const sql = neon(process.env.DATABASE_URL);
        const rows = await sql`SELECT payment_status FROM orders WHERE id = ${orderId}`;
        if (rows.length > 0) {
          return res.json({ success: rows[0].payment_status === 'paid', fallback: true });
        }
      } catch (_) {}
    }

    return res.status(500).json({ error: err.message });
  }
}
