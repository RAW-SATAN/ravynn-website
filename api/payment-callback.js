import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const body = req.body;

    // Verify HMAC-SHA256 signature
    const sig = req.headers['x-phonepe-signature'] || req.headers['x-verify'] || '';
    if (process.env.PHONEPE_CLIENT_SECRET && sig) {
      const expected = crypto.createHmac('sha256', process.env.PHONEPE_CLIENT_SECRET)
        .update(JSON.stringify(body))
        .digest('hex');
      if (sig !== expected) {
        console.warn('Webhook signature mismatch');
        return res.status(401).send('Unauthorized');
      }
    }

    if (body.event === 'checkout.order.completed') {
      const p = body.payload || {};
      const merchantOrderId = p.merchantOrderId || '';
      const orderId = merchantOrderId.replace(/^RAVYNN/, '');
      const status = p.state === 'COMPLETED' ? 'paid' : 'failed';

      if (orderId) {
        const sql = neon(process.env.DATABASE_URL);
        await sql`
          UPDATE orders SET
            payment_status = ${status},
            phonepe_state = ${p.state || ''},
            paid_at = ${status === 'paid' ? new Date().toISOString() : null}
          WHERE id = ${orderId}
        `;
      }
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('payment-callback:', err.message);
    return res.status(500).send('Error');
  }
}
