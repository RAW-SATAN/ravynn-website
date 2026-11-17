import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS page_events (
        id BIGSERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        session_id TEXT,
        page TEXT,
        referrer TEXT,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        device_type TEXT,
        product_id TEXT,
        product_name TEXT,
        product_price NUMERIC,
        quantity INTEGER,
        order_id TEXT,
        revenue NUMERIC,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_page_events_created ON page_events(created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_page_events_session ON page_events(session_id)`;
  } catch {}

  // POST: record event (no auth — called from frontend)
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const { event_type, session_id, page, referrer, utm_source, utm_medium, utm_campaign,
            device_type, product_id, product_name, product_price, quantity, order_id, revenue } = body || {};
    if (!event_type) return res.status(400).json({ error: 'event_type required' });
    try {
      await sql`
        INSERT INTO page_events (event_type,session_id,page,referrer,utm_source,utm_medium,utm_campaign,device_type,product_id,product_name,product_price,quantity,order_id,revenue)
        VALUES (${event_type},${session_id||null},${page||null},${referrer||null},${utm_source||null},${utm_medium||null},${utm_campaign||null},${device_type||null},${product_id||null},${product_name||null},${product_price||null},${quantity||null},${order_id||null},${revenue||null})
      `;
    } catch {}
    return res.json({ ok: true });
  }

  // GET: requires admin key
  if (req.method === 'GET') {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const { type, days } = req.query;
    const d = Number(days || 7);
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = dateRe.test(req.query.from || '') ? req.query.from : null;
    const to   = dateRe.test(req.query.to   || '') ? req.query.to   : null;
    const hasRange = !!(from && to);

    if (type === 'live') {
      const rows = await sql`
        SELECT COUNT(DISTINCT session_id) AS cnt FROM page_events
        WHERE created_at > NOW() - INTERVAL '2 minutes' AND session_id IS NOT NULL`;
      return res.json({ live: Number(rows[0]?.cnt || 0) });
    }

    if (type === 'stats') {
      if (hasRange) {
        const rows = await sql`SELECT
          COUNT(DISTINCT CASE WHEN event_type='pageview' THEN session_id END) AS visitors,
          COUNT(CASE WHEN event_type='pageview' THEN 1 END) AS pageviews,
          COUNT(DISTINCT CASE WHEN event_type='add_to_cart' THEN session_id END) AS add_to_cart,
          COUNT(DISTINCT CASE WHEN event_type='checkout_start' THEN session_id END) AS checkouts,
          COUNT(DISTINCT CASE WHEN event_type='purchase' THEN session_id END) AS purchases
          FROM page_events WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date`;
        return res.json({ today: rows[0] });
      }
      const [tod, wk, mo] = await Promise.all([
        sql`SELECT
          COUNT(DISTINCT CASE WHEN event_type IN ('pageview') THEN session_id END) AS visitors,
          COUNT(CASE WHEN event_type='pageview' THEN 1 END) AS pageviews,
          COUNT(DISTINCT CASE WHEN event_type='add_to_cart' THEN session_id END) AS add_to_cart,
          COUNT(DISTINCT CASE WHEN event_type='checkout_start' THEN session_id END) AS checkouts,
          COUNT(DISTINCT CASE WHEN event_type='purchase' THEN session_id END) AS purchases
          FROM page_events WHERE created_at >= CURRENT_DATE`,
        sql`SELECT COUNT(DISTINCT CASE WHEN event_type='pageview' THEN session_id END) AS visitors,
          COUNT(CASE WHEN event_type='pageview' THEN 1 END) AS pageviews
          FROM page_events WHERE created_at >= NOW()-INTERVAL '7 days'`,
        sql`SELECT COUNT(DISTINCT CASE WHEN event_type='pageview' THEN session_id END) AS visitors
          FROM page_events WHERE created_at >= NOW()-INTERVAL '30 days'`
      ]);
      return res.json({ today: tod[0], week: wk[0], month: mo[0] });
    }

    if (type === 'chart') {
      if (hasRange) {
        const rows = await sql`
          SELECT DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS date,
            COUNT(DISTINCT CASE WHEN event_type='pageview' THEN session_id END) AS visitors,
            COUNT(CASE WHEN event_type='pageview' THEN 1 END) AS pageviews
          FROM page_events
          WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date
          GROUP BY date ORDER BY date`;
        return res.json({ chart: rows });
      }
      const rows = await sql`
        SELECT DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS date,
          COUNT(DISTINCT CASE WHEN event_type='pageview' THEN session_id END) AS visitors,
          COUNT(CASE WHEN event_type='pageview' THEN 1 END) AS pageviews
        FROM page_events
        WHERE created_at >= NOW() - (${d}||' days')::INTERVAL
        GROUP BY date ORDER BY date`;
      return res.json({ chart: rows });
    }

    if (type === 'sources') {
      const rows = hasRange
        ? await sql`SELECT COALESCE(NULLIF(utm_source,''), NULLIF(referrer,''), 'direct') AS source,
            COUNT(DISTINCT session_id) AS visitors FROM page_events WHERE event_type='pageview'
            AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date
            GROUP BY source ORDER BY visitors DESC LIMIT 10`
        : await sql`SELECT COALESCE(NULLIF(utm_source,''), NULLIF(referrer,''), 'direct') AS source,
            COUNT(DISTINCT session_id) AS visitors FROM page_events WHERE event_type='pageview'
            AND created_at >= NOW()-INTERVAL '30 days'
            GROUP BY source ORDER BY visitors DESC LIMIT 10`;
      return res.json({ sources: rows });
    }

    if (type === 'pages') {
      const rows = hasRange
        ? await sql`SELECT page, COUNT(*) AS views, COUNT(DISTINCT session_id) AS visitors
            FROM page_events WHERE event_type='pageview'
            AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date
            GROUP BY page ORDER BY views DESC LIMIT 15`
        : await sql`SELECT page, COUNT(*) AS views, COUNT(DISTINCT session_id) AS visitors
            FROM page_events WHERE event_type='pageview'
            AND created_at >= NOW()-(${d}||' days')::INTERVAL
            GROUP BY page ORDER BY views DESC LIMIT 15`;
      return res.json({ pages: rows });
    }

    if (type === 'devices') {
      const rows = hasRange
        ? await sql`SELECT COALESCE(device_type,'unknown') AS device,
            COUNT(DISTINCT session_id) AS visitors FROM page_events WHERE event_type='pageview'
            AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date
            GROUP BY device ORDER BY visitors DESC`
        : await sql`SELECT COALESCE(device_type,'unknown') AS device,
            COUNT(DISTINCT session_id) AS visitors FROM page_events WHERE event_type='pageview'
            AND created_at >= NOW()-INTERVAL '30 days'
            GROUP BY device ORDER BY visitors DESC`;
      return res.json({ devices: rows });
    }

    if (type === 'campaigns') {
      const rows = hasRange
        ? await sql`SELECT utm_campaign, utm_source, utm_medium,
            COUNT(DISTINCT session_id) AS visitors,
            COUNT(DISTINCT CASE WHEN event_type='purchase' THEN session_id END) AS conversions
            FROM page_events WHERE utm_campaign IS NOT NULL
            AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date
            GROUP BY utm_campaign, utm_source, utm_medium ORDER BY visitors DESC LIMIT 20`
        : await sql`SELECT utm_campaign, utm_source, utm_medium,
            COUNT(DISTINCT session_id) AS visitors,
            COUNT(DISTINCT CASE WHEN event_type='purchase' THEN session_id END) AS conversions
            FROM page_events WHERE utm_campaign IS NOT NULL
            AND created_at >= NOW()-INTERVAL '30 days'
            GROUP BY utm_campaign, utm_source, utm_medium ORDER BY visitors DESC LIMIT 20`;
      return res.json({ campaigns: rows });
    }

    if (type === 'funnel') {
      const rows = hasRange
        ? await sql`SELECT
            COUNT(DISTINCT CASE WHEN event_type='pageview' THEN session_id END) AS visited,
            COUNT(DISTINCT CASE WHEN event_type='add_to_cart' THEN session_id END) AS added_cart,
            COUNT(DISTINCT CASE WHEN event_type='checkout_start' THEN session_id END) AS checkout_started,
            COUNT(DISTINCT CASE WHEN event_type='purchase' THEN session_id END) AS purchased
            FROM page_events WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date`
        : await sql`SELECT
            COUNT(DISTINCT CASE WHEN event_type='pageview' THEN session_id END) AS visited,
            COUNT(DISTINCT CASE WHEN event_type='add_to_cart' THEN session_id END) AS added_cart,
            COUNT(DISTINCT CASE WHEN event_type='checkout_start' THEN session_id END) AS checkout_started,
            COUNT(DISTINCT CASE WHEN event_type='purchase' THEN session_id END) AS purchased
            FROM page_events WHERE created_at >= NOW()-INTERVAL '30 days'`;
      return res.json({ funnel: rows[0] });
    }

    if (type === 'events') {
      const rows = await sql`
        SELECT event_type, page, product_name, device_type, utm_source, created_at
        FROM page_events ORDER BY created_at DESC LIMIT 100`;
      return res.json({ events: rows });
    }

    if (type === 'atc') {
      const rows = hasRange
        ? await sql`SELECT product_name, COUNT(*) AS count, SUM(quantity) AS total_qty
            FROM page_events WHERE event_type='add_to_cart'
            AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date
            GROUP BY product_name ORDER BY count DESC LIMIT 10`
        : await sql`SELECT product_name, COUNT(*) AS count, SUM(quantity) AS total_qty
            FROM page_events WHERE event_type='add_to_cart'
            AND created_at >= NOW()-(${d}||' days')::INTERVAL
            GROUP BY product_name ORDER BY count DESC LIMIT 10`;
      return res.json({ atc: rows });
    }

    return res.status(400).json({ error: 'Invalid type' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
