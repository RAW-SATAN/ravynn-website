import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const sql = neon(process.env.DATABASE_URL);

  // Public: customer registration (no admin key needed)
  if (req.method === 'POST' && req.body?.type === 'register') {
    const { uid, name, email, phone } = req.body;
    if (!uid || !email) return res.status(400).json({ error: 'uid and email required' });
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS registered_customers (
          id BIGSERIAL PRIMARY KEY,
          uid TEXT UNIQUE,
          name TEXT,
          email TEXT,
          phone TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`
        INSERT INTO registered_customers (uid, name, email, phone)
        VALUES (${uid}, ${name||null}, ${email}, ${phone||null})
        ON CONFLICT (uid) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, phone=EXCLUDED.phone
      `;
    } catch {}
    return res.json({ ok: true });
  }

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const { limit = 200, status, id, type } = req.query;

      if (type === 'customers') {
        try {
          await sql`CREATE TABLE IF NOT EXISTS registered_customers (id BIGSERIAL PRIMARY KEY, uid TEXT UNIQUE, name TEXT, email TEXT, phone TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
        } catch {}
        const rows = await sql`
          SELECT rc.uid, rc.name, rc.email, rc.phone, rc.created_at,
            COUNT(o.id) AS orders,
            COALESCE(SUM(CASE WHEN o.payment_status='paid' THEN o.amount ELSE 0 END), 0) AS total_spent,
            MAX(o.created_at) AS last_order
          FROM registered_customers rc
          LEFT JOIN orders o ON o.customer_phone = rc.phone
          GROUP BY rc.uid, rc.name, rc.email, rc.phone, rc.created_at
          ORDER BY rc.created_at DESC
        `;
        return res.json({ customers: rows });
      }

      if (id) {
        const rows = await sql`SELECT * FROM orders WHERE id = ${id}`;
        return res.json({ order: rows[0] || null });
      }

      const rows = status
        ? await sql`SELECT * FROM orders WHERE payment_status = ${status} ORDER BY created_at DESC LIMIT ${Number(limit)}`
        : await sql`SELECT * FROM orders ORDER BY created_at DESC LIMIT ${Number(limit)}`;

      return res.json({ orders: rows });
    }

    if (req.method === 'POST') {
      return res.status(400).json({ error: 'Missing type' });
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
