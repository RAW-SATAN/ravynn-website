export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { filename, base64 } = req.body;
  if (!filename || !base64) return res.status(400).json({ error: 'filename and base64 required' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });

  const owner = 'gsnshopifycare-max';
  const repo = 'ravynn-website';
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `assets/products/${safeName}`;

  let sha;
  try {
    const check = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'ravynn-admin' }
    });
    if (check.ok) sha = (await check.json()).sha;
  } catch {}

  const uploadRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'ravynn-admin'
    },
    body: JSON.stringify({
      message: `Upload product image: ${safeName}`,
      content: base64,
      ...(sha ? { sha } : {})
    })
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    return res.status(500).json({ error: err.message || 'GitHub upload failed' });
  }

  return res.json({
    url: `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`
  });
}
