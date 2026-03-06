-- Paper Trading Bot - Supabase schema
-- Run in Supabase SQL Editor: Dashboard -> SQL Editor -> New query

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  alert_key text UNIQUE NOT NULL,
  raw jsonb,
  parsed jsonb,
  ticker text,
  action text,
  price numeric,
  stop numeric,
  timeframe text
);

CREATE TABLE decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid REFERENCES alerts(id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  approve boolean NOT NULL,
  confidence numeric,
  entry numeric,
  stop numeric,
  target numeric,
  reason text,
  notes text,
  raw_ai jsonb,
  blocked_reason text
);

CREATE TABLE trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid REFERENCES decisions(id),
  placed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  qty int,
  side text,
  symbol text,
  alpaca_order_id text,
  alpaca_raw jsonb,
  error text
);

CREATE INDEX idx_alerts_ticker ON alerts(ticker);
CREATE INDEX idx_alerts_received_at ON alerts(received_at DESC);
CREATE INDEX idx_trades_placed_at ON trades(placed_at DESC);
CREATE INDEX idx_trades_decision_id ON trades(decision_id);
