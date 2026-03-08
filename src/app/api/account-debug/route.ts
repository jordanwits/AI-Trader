import { NextResponse } from "next/server";
import { getAccount, getPositions } from "@/lib/alpaca";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Debug endpoint: raw Alpaca account + positions + reconciliation. Use to compare with Alpaca dashboard. */
export async function GET() {
  try {
    const [account, positions] = await Promise.all([getAccount(), getPositions()]);
    const isPaper = env.ALPACA_BASE_URL.includes("paper");
    const cashNum = Number(account.cash);
    const positionsMarketValue = positions.reduce((sum, p) => sum + Number(p.market_value), 0);
    const computedEquity = cashNum + positionsMarketValue;
    const accountEquityNum = Number(account.equity);
    const equityDiff = accountEquityNum - computedEquity;

    return NextResponse.json({
      account: {
        equity: account.equity,
        portfolio_value: account.portfolio_value,
        cash: account.cash,
        buying_power: account.buying_power,
        last_equity: account.last_equity,
      },
      positions: positions.map((p) => ({
        symbol: p.symbol,
        market_value: p.market_value,
        unrealized_pl: p.unrealized_pl,
        current_price: p.current_price,
        avg_entry_price: p.avg_entry_price,
        cost_basis: p.cost_basis,
        qty: p.qty,
      })),
      api_config: { trading_url: env.ALPACA_BASE_URL },
      reconciliation: {
        cash: cashNum,
        sum_positions_market_value: positionsMarketValue,
        computed_equity_cash_plus_positions: computedEquity.toFixed(2),
        account_equity_from_api: accountEquityNum,
        difference: equityDiff.toFixed(2),
        note:
          Math.abs(equityDiff) > 0.01
            ? "Account API equity ≠ cash + positions. Alpaca may value positions differently between /account and /positions."
            : "Account equity matches cash + positions.",
      },
      api_source: isPaper ? "paper-api.alpaca.markets (Paper)" : "api.alpaca.markets (Live)",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
