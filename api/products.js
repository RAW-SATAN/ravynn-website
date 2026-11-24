import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_total INTEGER`;
  } catch {}

  if (req.method === 'GET') {
    const { handle, id, admin, sold } = req.query;
    const isAdmin = req.headers['x-admin-key'] && req.headers['x-admin-key'] === process.env.ADMIN_KEY;

    if (handle) {
      const rows = await sql`SELECT * FROM products WHERE handle = ${handle} ${isAdmin ? sql`` : sql`AND available = true`}`;
      const product = rows[0] || null;
      if (product && sold === '1') {
        try {
          const sc = await sql`SELECT COALESCE(SUM((el->>'qty')::int),0) AS sold_count
            FROM orders, jsonb_array_elements(items::jsonb) AS el
            WHERE payment_status IN ('paid','cod') AND el->>'handle' = ${handle}`;
          product.sold_count = Number(sc[0]?.sold_count || 0);
        } catch { product.sold_count = 0; }
      }
      return res.json({ product });
    }
    if (id) {
      const rows = await sql`SELECT * FROM products WHERE id = ${parseInt(id)}`;
      return res.json({ product: rows[0] || null });
    }
    const rows = isAdmin
      ? await sql`SELECT * FROM products ORDER BY id ASC`
      : await sql`SELECT * FROM products WHERE available = true ORDER BY id ASC`;
    return res.json({ products: rows });
  }

  if (!process.env.ADMIN_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'POST') {
    const { handle, title, price, compare_at_price, type, collections, images, sizes, available, description, stock_total } = req.body;
    if (!handle || !title || !price) return res.status(400).json({ error: 'handle, title, price required' });
    const rows = await sql`
      INSERT INTO products (handle, title, price, compare_at_price, type, collections, images, sizes, available, description, stock_total)
      VALUES (
        ${handle}, ${title}, ${Number(price)},
        ${compare_at_price ? Number(compare_at_price) : null},
        ${type || ''}, ${collections || []}, ${images || []},
        ${sizes || ['S','M','L','XL']}, ${available !== false}, ${description || ''},
        ${stock_total ? Number(stock_total) : null}
      )
      ON CONFLICT (handle) DO UPDATE SET
        title = EXCLUDED.title, price = EXCLUDED.price,
        compare_at_price = EXCLUDED.compare_at_price,
        type = EXCLUDED.type, collections = EXCLUDED.collections,
        images = EXCLUDED.images, sizes = EXCLUDED.sizes,
        available = EXCLUDED.available, description = EXCLUDED.description,
        stock_total = EXCLUDED.stock_total,
        updated_at = NOW()
      RETURNING *
    `;
    return res.status(201).json({ product: rows[0] });
  }

  if (req.method === 'PUT') {
    const { id, handle, title, price, compare_at_price, type, collections, images, sizes, available, description, stock_total } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const rows = await sql`
      UPDATE products SET
        handle = ${handle}, title = ${title}, price = ${Number(price)},
        compare_at_price = ${compare_at_price ? Number(compare_at_price) : null},
        type = ${type || ''}, collections = ${collections || []},
        images = ${images || []}, sizes = ${sizes || ['S','M','L','XL']},
        available = ${available !== false}, description = ${description || ''},
        stock_total = ${stock_total ? Number(stock_total) : null},
        updated_at = NOW()
      WHERE id = ${parseInt(id)}
      RETURNING *
    `;
    return res.json({ product: rows[0] || null });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    await sql`DELETE FROM products WHERE id = ${parseInt(id)}`;
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
