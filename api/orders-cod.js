import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { orderId, amount, customer_name, customer_phone, items, address, coupon, shipping_method, payment_method } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    const sql = neon(process.env.DATABASE_URL);
    const notes = [
      payment_method ? `Payment: ${payment_method.toUpperCase()}` : 'COD',
      coupon ? `Coupon: ${coupon}` : null,
      shipping_method ? `Shipping: ${shipping_method}` : null
    ].filter(Boolean).join(' | ');

    await sql`
      INSERT INTO orders (id, payment_status, amount, customer_name, customer_phone, items, address, notes)
      VALUES (
        ${orderId}, 'pending', ${Number(amount)},
        ${customer_name || ''}, ${customer_phone || ''},
        ${JSON.stringify(items || [])},
        ${JSON.stringify(address || {})},
        ${notes}
      )
      ON CONFLICT (id) DO NOTHING
    `;
    return res.json({ success: true });
  } catch (err) {
    console.error('orders-cod:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
