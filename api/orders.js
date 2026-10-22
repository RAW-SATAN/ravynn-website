import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    if (req.method === 'GET') {
      const { limit = 200, status, id } = req.query;

      if (id) {
        const rows = await sql`SELECT * FROM orders WHERE id = ${id}`;
        return res.json({ order: rows[0] || null });
      }

      const rows = status
        ? await sql`SELECT * FROM orders WHERE payment_status = ${status} ORDER BY created_at DESC LIMIT ${Number(limit)}`
        : await sql`SELECT * FROM orders ORDER BY created_at DESC LIMIT ${Number(limit)}`;

      return res.json({ orders: rows });
    }

    if (req.method === 'PATCH') {
      const { id, fulfillment_status, tracking_number, payment_status } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });

      // Ensure columns exist
      try {
        await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_status text DEFAULT 'unfulfilled'`;
        await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number text`;
        await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text`;
      } catch {}

      if (payment_status !== undefined) {
        await sql`UPDATE orders SET payment_status = ${payment_status} WHERE id = ${id}`;
      } else {
        await sql`
          UPDATE orders SET
            fulfillment_status = ${fulfillment_status || 'unfulfilled'},
            tracking_number = ${tracking_number || null}
          WHERE id = ${id}
        `;
      }
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('orders:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
