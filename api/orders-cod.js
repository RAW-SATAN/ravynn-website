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
    const paymentStatus = (!payment_method || payment_method === 'cod') ? 'pending' : 'paid';
    const notes = [
      payment_method ? `Payment: ${payment_method.toUpperCase()}` : 'COD',
      coupon ? `Coupon: ${coupon}` : null,
      shipping_method ? `Shipping: ${shipping_method}` : null
    ].filter(Boolean).join(' | ');

    await sql`
      INSERT INTO orders (id, payment_status, amount, customer_name, customer_phone, items, address, notes)
      VALUES (
        ${orderId}, ${paymentStatus}, ${Number(amount)},
        ${customer_name || ''}, ${customer_phone || ''},
        ${JSON.stringify(items || [])},
        ${JSON.stringify(address || {})},
        ${notes}
      )
      ON CONFLICT (id) DO NOTHING
    `;

    try {
      const { createDelhiveryShipment } = await import('./delhivery.js');
      const dResult = await createDelhiveryShipment({ id: orderId, amount, customer_name, customer_phone, items, address, payment_status: paymentStatus });
      const pkg = dResult.packages && dResult.packages[0];
      if (pkg && pkg.waybill) {
        await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS awb_number text`;
        await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delhivery_status text`;
        await sql`UPDATE orders SET awb_number = ${pkg.waybill}, delhivery_status = 'booked' WHERE id = ${orderId}`;
      }
    } catch (dErr) {
      console.error('auto delhivery:', dErr.message);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('orders-cod:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
