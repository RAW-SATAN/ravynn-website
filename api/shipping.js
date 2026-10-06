import { neon } from '@neondatabase/serverless';

const DEFAULT = { standard_rate: 0, express_rate: 99, free_threshold: 0, cod_extra: 0, per_product: {}, rules: [] };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=60, max-age=60');
  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT value FROM settings WHERE key = 'shipping'`;
    return res.json(rows[0]?.value || DEFAULT);
  } catch {
    return res.json(DEFAULT);
  }
}
