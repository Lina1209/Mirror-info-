CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'Новая',
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  payment TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  chars INTEGER,
  language TEXT NOT NULL DEFAULT '',
  file_link TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  estimate TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS order_rate_limits (
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS order_rate_limits_idx ON order_rate_limits(ip_hash, created_at);
