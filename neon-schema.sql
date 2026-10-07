-- Run this ONCE in Neon SQL Editor after creating your database

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  phonepe_txn_id  TEXT,
  payment_status  TEXT DEFAULT 'pending',
  phonepe_state   TEXT,
  amount          NUMERIC(10,2),
  customer_name   TEXT,
  customer_phone  TEXT,
  items           JSONB DEFAULT '[]',
  address         JSONB,
  notes           TEXT,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- Admin-configurable settings
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES (
  'shipping',
  '{"standard_rate":0,"express_rate":99,"free_threshold":0,"cod_extra":0,"per_product":{},"rules":[]}'
) ON CONFLICT (key) DO NOTHING;

-- Products table (for admin product management)
CREATE TABLE IF NOT EXISTS products (
  id               SERIAL PRIMARY KEY,
  handle           TEXT UNIQUE NOT NULL,
  title            TEXT NOT NULL,
  price            NUMERIC(10,2) NOT NULL,
  compare_at_price NUMERIC(10,2),
  type             TEXT DEFAULT '',
  collections      TEXT[] DEFAULT '{}',
  images           TEXT[] DEFAULT '{}',
  sizes            TEXT[] DEFAULT '{"S","M","L","XL"}',
  available        BOOLEAN DEFAULT true,
  description      TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_handle    ON products(handle);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(available);
