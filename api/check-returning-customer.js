import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { phone } = req.query;
  if (!phone || !/^\d{10}$/.test(phone.replace(/\D/g, '').slice(-10))) {
    return res.status(400).json({ error: 'Invalid phone' });
  }

  const normalized = phone.replace(/\D/g, '').slice(-10);

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT 1 FROM orders
      WHERE RIGHT(REGEXP_REPLACE(customer_phone, '[^0-9]', '', 'g'), 10) = ${normalized}
        AND payment_status IN ('paid', 'cod')
      LIMIT 1
    `;
    return res.json({ is_returning: rows.length > 0 });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
}
