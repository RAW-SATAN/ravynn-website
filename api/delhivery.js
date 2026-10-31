import { neon } from '@neondatabase/serverless';

const TOKEN = process.env.DELHIVERY_TOKEN;
const PICKUP = process.env.DELHIVERY_PICKUP || 'Primary';
const BASE = 'https://track.delhivery.com';

export async function createDelhiveryShipment(order) {
  const rawItems = order.items;
  const items = Array.isArray(rawItems) ? rawItems
    : (typeof rawItems === 'string' ? JSON.parse(rawItems || '[]') : []);
  const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 1), 0) || 1;
  const weightGrams = Math.max(500, totalQty * 300);
  const addr = (typeof order.address === 'string' ? JSON.parse(order.address || '{}') : order.address) || {};
  const isCOD = order.payment_status !== 'paid';

  const shipmentData = {
    shipments: [{
      add: [addr.address, addr.city].filter(Boolean).join(', ') || 'N/A',
      address_type: 'home',
      name: order.customer_name || addr.name || 'Customer',
      phone: String(order.customer_phone || '').replace(/\D/g, '').slice(-10),
      pin: String(addr.pincode || ''),
      city: addr.city || '',
      state: addr.state || '',
      country: 'India',
      payment_mode: isCOD ? 'COD' : 'Prepaid',
      cod_amount: isCOD ? Number(order.amount || 0) : '',
      order: String(order.id),
      total_amount: Number(order.amount || 0),
      products_desc: items.slice(0, 3).map(i => (i.title || '').replace(/^RAVYNN\s+/i, '').slice(0, 30)).filter(Boolean).join(', ') || 'T-Shirt',
      quantity: String(totalQty),
      weight: weightGrams,
      waybill: '',
      shipment_length: 30,
      shipment_width: 25,
      shipment_height: Math.max(3, totalQty * 3),
      shipping_mode: 'Surface',
    }],
    pickup_location: { name: PICKUP }
  };

  const body = new URLSearchParams({ format: 'json', data: JSON.stringify(shipmentData) });
  const r = await fetch(`${BASE}/api/cmu/create.json`, {
    method: 'POST',
    headers: { 'Authorization': `Token ${TOKEN}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch(e) {
    return { error: `Delhivery HTTP ${r.status}: ${text.slice(0, 400)}` };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const { action, waybill, order, orderId } = req.body;
  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS awb_number text`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delhivery_status text`;

    if (action === 'create') {
      if (!order) return res.status(400).json({ error: 'order required' });
      const result = await createDelhiveryShipment(order);
      const pkg = result.packages && result.packages[0];
      if (pkg && pkg.waybill) {
        await sql`UPDATE orders SET awb_number = ${pkg.waybill}, delhivery_status = 'booked' WHERE id = ${order.id}`;
        return res.json({ success: true, waybill: pkg.waybill, result });
      }
      return res.json({ success: false, error: result.error || JSON.stringify(result) });
    }

    if (action === 'track') {
      if (!waybill) return res.status(400).json({ error: 'waybill required' });
      const r = await fetch(`${BASE}/api/v1/packages/json/?waybill=${waybill}&token=${TOKEN}`);
      const data = await r.json();
      const ship = data.ShipmentData && data.ShipmentData[0] && data.ShipmentData[0].Shipment;
      if (!ship) return res.json({ success: false, data });
      const sType = ship.Status && ship.Status.StatusType;
      const sText = ship.Status && ship.Status.Status;
      const statusMap = { DL: 'delivered', RT: 'rto', CA: 'cancelled', OT: 'in-transit', IT: 'in-transit', UD: 'undelivered', PKD: 'picked-up', DIS: 'dispatched' };
      const normalized = statusMap[sType] || (sType || 'unknown').toLowerCase();
      if (orderId) {
        const autoFulfill = normalized === 'delivered' ? 'shipped' : undefined;
        if (autoFulfill) {
          await sql`UPDATE orders SET delhivery_status = ${normalized}, fulfillment_status = ${autoFulfill} WHERE id = ${orderId}`;
        } else {
          await sql`UPDATE orders SET delhivery_status = ${normalized} WHERE id = ${orderId}`;
        }
      }
      return res.json({ success: true, status: normalized, statusText: sText, scans: ship.Scans });
    }

    if (action === 'cancel') {
      if (!waybill) return res.status(400).json({ error: 'waybill required' });
      const r = await fetch(`${BASE}/api/p/edit?waybill=${waybill}&cancellation=true`, {
        method: 'GET',
        headers: { 'Authorization': `Token ${TOKEN}` }
      });
      const data = await r.json();
      if (orderId) await sql`UPDATE orders SET delhivery_status = 'cancelled' WHERE id = ${orderId}`;
      return res.json({ success: true, data });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    console.error('delhivery:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
