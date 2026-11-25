import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const sql = neon(process.env.DATABASE_URL);

  await sql`
    CREATE TABLE IF NOT EXISTS reviews (
      id BIGSERIAL PRIMARY KEY,
      product_handle TEXT NOT NULL,
      name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_reviews_handle ON reviews(product_handle, status, created_at DESC)`;
  await sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS image TEXT`;

  if (req.method === 'GET') {
    const { handle, all } = req.query;
    const isAdmin = req.headers['x-admin-key'] === process.env.ADMIN_KEY;

    if (all === '1') {
      if (!isAdmin) return res.status(401).json({ error: 'Unauthorized' });
      const rows = await sql`SELECT * FROM reviews ORDER BY created_at DESC LIMIT 200`;
      return res.json({ reviews: rows });
    }

    if (!handle) return res.status(400).json({ error: 'handle required' });
    const rows = await sql`
      SELECT id, name, rating, body, image, created_at FROM reviews
      WHERE product_handle = ${handle} AND status = 'approved'
      ORDER BY created_at DESC LIMIT 50
    `;
    return res.json({ reviews: rows });
  }

  if (req.method === 'POST') {
    const isAdmin = req.headers['x-admin-key'] === process.env.ADMIN_KEY;
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    // Admin actions: approve/reject/delete
    if (isAdmin && body.action) {
      const { action, id } = body;
      if (action === 'approve') await sql`UPDATE reviews SET status='approved' WHERE id=${id}`;
      else if (action === 'reject') await sql`UPDATE reviews SET status='rejected' WHERE id=${id}`;
      else if (action === 'delete') await sql`DELETE FROM reviews WHERE id=${id}`;
      return res.json({ ok: true });
    }

    // Public: submit review
    const { product_handle, name, rating, review_body, image } = body || {};
    if (!product_handle || !name || !rating || !review_body)
      return res.status(400).json({ error: 'product_handle, name, rating, review_body required' });
    const r = Number(rating);
    if (r < 1 || r > 5) return res.status(400).json({ error: 'rating must be 1-5' });
    const cleanName = String(name).slice(0, 60).replace(/[<>]/g, '');
    const cleanBody = String(review_body).slice(0, 1000).replace(/[<>]/g, '');
    // Accept base64 image (data:image/jpeg;base64,...), max ~300KB
    const cleanImage = image && typeof image === 'string' && image.startsWith('data:image/') && image.length < 400000 ? image : null;
    await sql`
      INSERT INTO reviews (product_handle, name, rating, body, image, status)
      VALUES (${product_handle}, ${cleanName}, ${r}, ${cleanBody}, ${cleanImage}, 'pending')
    `;
    return res.json({ ok: true, message: 'Review submitted! It will appear after moderation.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
