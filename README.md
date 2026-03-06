# Paper Trading Bot

Serverless paper-trading bot: TradingView webhook → Risk checks → AI decision → Alpaca execution. Next.js App Router + Supabase + OpenAI + Alpaca.

## Stack

- Next.js 14 (App Router)
- TypeScript (strict)
- Zod validation
- Supabase Postgres
- OpenAI (gpt-4o-mini)
- Alpaca paper trading

## Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Open **Dashboard → SQL Editor → New query**
3. Paste and run the contents of `supabase.sql`
4. Copy **Project URL** and **service_role** key from **Settings → API**

## Environment Variables

Copy `.env.example` to `.env.local` and fill values.

**Required:**

- `SUPABASE_URL` – Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` – Supabase service role key
- `ALPACA_KEY` – Alpaca API key ID
- `ALPACA_SECRET` – Alpaca secret key
- `ALPACA_BASE_URL` – Paper: `https://paper-api.alpaca.markets`
- `OPENAI_API_KEY` – OpenAI API key

**Optional (defaults shown):**

- `OPENAI_MODEL` – default `gpt-4o-mini`
- `WEBHOOK_SECRET` – if set, require `x-webhook-secret` header
- `ACCOUNT_EQUITY` – default 100000
- `RISK_PER_TRADE_DOLLARS` – default 50
- `MAX_TRADES_PER_DAY` – default 5
- `MAX_DAILY_LOSS_DOLLARS` – default 150
- `COOLDOWN_SECONDS` – default 180
- `MIN_STOP_DISTANCE` – default 0.05
- `LOG_LEVEL` – default `info`

For Vercel: add these in **Project Settings → Environment Variables**.

## Run Locally

```bash
pnpm i
pnpm dev
```

App runs at `http://localhost:3000`.

## Expose Local Endpoint (ngrok)

TradingView webhooks require HTTPS. For local dev:

```bash
ngrok http 3000
```

Use the HTTPS URL (e.g. `https://abc123.ngrok.io`) + `/api/tv` as the webhook target.

## TradingView Webhook Alert

1. Add the indicator: open `pine/ai_bot_starter_signal.pine` in TradingView Pine Editor, add to chart
2. Right-click chart → **Add alert on…** → select the indicator
3. Condition: **Once Per Bar Close**
4. **Webhook URL**: `https://your-app.vercel.app/api/tv` (or ngrok URL for local)
5. If using `WEBHOOK_SECRET`, add header `x-webhook-secret` with the secret value in the alert settings

Note: TradingView webhook alerts require a paid plan or trial.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check |
| POST | /api/tv | TradingView webhook (main) |
| GET | /api/alerts?limit=50 | List alerts |
| GET | /api/trades?limit=50 | List trades |
| GET | /api/stats | Today summary |

## Curl Tests

**Health:**
```bash
curl http://localhost:3000/api/health
```

**Webhook (sample payload):**
```bash
curl -X POST http://localhost:3000/api/tv -H "Content-Type: application/json" -d "{\"ticker\":\"SPY\",\"timeframe\":\"5\",\"action\":\"BUY\",\"price\":512.34,\"stop\":511.84}"
```

**Trades:**
```bash
curl http://localhost:3000/api/trades
```

## Deploy to Vercel

1. Push repo to GitHub (or connect Vercel to your repo)
2. Import project in Vercel
3. Add all env vars in project settings
4. Deploy

CLI:

```bash
vercel
```

## Post-Generation Steps

1. **Supabase**: Create project → SQL Editor → run `supabase.sql`
2. **Env vars**: Copy `.env.example` → `.env.local`, fill required values
3. **Vercel**: Add same env vars in project settings
4. **TradingView**: Add indicator → Create alert → Webhook URL = `https://your-app.vercel.app/api/tv`
