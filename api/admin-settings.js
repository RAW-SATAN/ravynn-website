import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const isAdmin = process.env.ADMIN_KEY && req.headers['x-admin-key'] === process.env.ADMIN_KEY;

  const sql = neon(process.env.DATABASE_URL);

  // Public GET \u2014 coupons and shipping needed by checkout
  if (req.method === 'GET') {
    const { key = 'shipping' } = req.query;
    if (!isAdmin && key !== 'coupons' && key !== 'shipping' && key !== 'hide_atc') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const rows = await sql`SELECT value FROM settings WHERE key = ${key}`;
    return res.json({ success: true, value: rows[0]?.value ?? null });
  }

  if (!isAdmin) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'POST') {
    const { key, value } = req.body;
    if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' });
    await sql`
      INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(value)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
