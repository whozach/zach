-- Crypto Client store (client-store-plan.md §4). Additive only: one new
-- table + indexes; licenses / activations / audit are not changed.
CREATE TABLE orders (
  id                 TEXT PRIMARY KEY,          -- "ord_" + 16 Crockford chars
  claim_secret_hash  TEXT NOT NULL,             -- SHA-256 of the claim secret (secret shown once)
  plan               TEXT NOT NULL CHECK (plan IN ('30d','90d','365d','lifetime')),
  chain              TEXT NOT NULL CHECK (chain IN ('solana','ethereum','bitcoin')),
  asset              TEXT NOT NULL CHECK (asset IN ('usdc','sol','eth','btc')),
  usd_price_cents    INTEGER NOT NULL,
  coin_price         TEXT,                      -- quoted USD per coin; null for USDC
  price_source_a     TEXT,
  price_source_b     TEXT,
  expected_amount    TEXT NOT NULL,             -- integer string, smallest units
  amount_decimals    INTEGER NOT NULL,
  recipient          TEXT NOT NULL,
  reference          TEXT,                      -- Solana Pay reference (base58)
  status             TEXT NOT NULL CHECK (status IN ('pending','seen','paid','expired','manual')),
  expires_at         INTEGER NOT NULL,          -- unix seconds, 15 min from create
  seen_at            INTEGER,
  seen_txid          TEXT,                      -- informational; not unique (paid txid is)
  paid_at            INTEGER,
  chain_txid         TEXT,                      -- signature or txid (paid/manual only)
  chain_index        INTEGER,                   -- BTC vout, ETH token logIndex (-1 = native ETH), 0 for Solana
  amount_paid        TEXT,
  license_id         TEXT REFERENCES licenses(id),
  issued_key         TEXT,                      -- plaintext CC- key while revealable (max 7 days)
  revealed_at        INTEGER,
  renew_license_id   TEXT,
  checked_at         INTEGER,                   -- last on-chain check (poll throttle)
  note               TEXT,
  created_at         INTEGER NOT NULL
);

-- Unique exact amount among open invoices
CREATE UNIQUE INDEX idx_orders_open_amount
  ON orders(chain, asset, expected_amount)
  WHERE status IN ('pending','seen');

-- One payment unlocks at most one order
CREATE UNIQUE INDEX idx_orders_txid
  ON orders(chain, chain_txid, chain_index)
  WHERE chain_txid IS NOT NULL;

CREATE UNIQUE INDEX idx_orders_reference
  ON orders(reference) WHERE reference IS NOT NULL;

CREATE INDEX idx_orders_status ON orders(status, created_at);
CREATE INDEX idx_orders_paid ON orders(paid_at) WHERE paid_at IS NOT NULL;
