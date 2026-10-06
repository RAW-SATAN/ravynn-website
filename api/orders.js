import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Simple admin key protection
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const { limit = 50, status } = req.query;

    const rows = status
      ? await sql`SELECT * FROM orders WHERE payment_status = ${status} ORDER BY created_at DESC LIMIT ${Number(limit)}`
      : await sql`SELECT * FROM orders ORDER BY created_at DESC LIMIT ${Number(limit)}`;

    return res.json({ orders: rows });
  } catch (err) {
    console.error('orders:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
