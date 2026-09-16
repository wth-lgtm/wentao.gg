"use client";

import { AddressLegend, Legend, dash } from "./Instrument";
import { formatCurrency, toneClass } from "../lib/formatters";
import { formatPrice, formatSize } from "../lib/fills";
import { PerpPosition, SpotBalance, TraderSnapshot } from "../lib/trader";

// The Positions tab: what one whale is actually holding right now.
//
// A verified fact that shapes this whole panel: of eight top-50 addresses sampled
// live, only FOUR held any open perp position at all. An empty list is therefore
// the common case, not a failure, and it gets a designed state that says so —
// especially since these accounts always hold spot balances, so "nothing here"
// would be actively misleading.

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Legend>{label}</Legend>
      <span className="tabular-nums text-sm text-foreground">{children}</span>
    </div>
  );
}

const money = (v: number | null, decimals = 2) =>
  v === null ? dash : formatCurrency(v, { compact: Math.abs(v) >= 10_000, decimals });

function SideBadge({ side }: { side: PerpPosition["side"] }) {
  // Word + glyph + colour: three cues, so side never depends on hue alone.
  const tone =
    side === "LONG" ? "text-[var(--gain)]" : side === "SHORT" ? "text-[var(--loss)]" : "text-muted";
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${tone}`}>
      <span aria-hidden className="mr-1">
        {side === "LONG" ? "▲" : side === "SHORT" ? "▼" : "·"}
      </span>
      {side}
    </span>
  );
}

function PositionCard({ p }: { p: PerpPosition }) {
  return (
    <li className="rounded-xl border border-border bg-background/40 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-foreground">{p.coin}</span>
          <SideBadge side={p.side} />
          {p.leverage !== null && (
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
              {p.leverage}× {p.leverageType}
            </span>
          )}
        </div>
        <span className={`tabular-nums font-semibold ${toneClass(p.unrealizedPnl ?? 0)}`}>
          {p.unrealizedPnl === null ? dash : formatCurrency(p.unrealizedPnl, { showSign: true, compact: true })}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Size">
          {p.szi === null ? dash : formatSize(Math.abs(p.szi))}
        </Metric>
        <Metric label="Entry">{formatPrice(p.entryPx)}</Metric>
        <Metric label="Value">{money(p.positionValue)}</Metric>
        <Metric label="ROE">
          {p.roe === null ? dash : (
            <span className={toneClass(p.roe)}>{(p.roe * 100).toFixed(2)}%</span>
          )}
        </Metric>
        <Metric label="Liq. price">{formatPrice(p.liquidationPx)}</Metric>
        <Metric label="Funding since open">
          {p.fundingSinceOpen === null ? dash : (
            // Already in the trader's P&L sign (see PerpPosition.fundingSinceOpen).
            <span className={toneClass(p.fundingSinceOpen)}>
              {formatCurrency(p.fundingSinceOpen, { showSign: true, compact: true })}
              <span className="sr-only">
                {p.fundingSinceOpen > 0 ? " received" : p.fundingSinceOpen < 0 ? " paid" : ""}
              </span>
            </span>
          )}
        </Metric>
      </div>
    </li>
  );
}

/**
 * The absent state, which is NOT the empty state.
 *
 * The route answers 200 with a partial body when one of its three upstream calls
 * fails — Hyperliquid returns 429 on a second sequential call from a shared egress IP
 * — and the snapshot carries that as null. Rendering the designed "currently flat"
 * copy over it asserted a fact about the whale that the app did not have.
 */
function Unavailable({
  reason,
  onRetry,
  busy,
}: {
  reason: string;
  onRetry?: () => void;
  busy: boolean;
}) {
  return (
    <>
      <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--loss)]">
        {reason}
      </p>
      {onRetry && <ReRead onRetry={onRetry} busy={busy} />}
    </>
  );
}

// Re-asks for THIS address through useTrader's reload, so the tab, the selection and
// the rest of the snapshot all survive the retry. Disabled while a request is in
// flight because a partial 200 leaves `data` populated, so nothing else on screen
// changes to say the click landed.
function ReRead({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={busy}
      className="mt-3 rounded border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)] transition-colors hover:text-foreground disabled:opacity-50"
    >
      {busy ? "Re-reading" : "Re-read"}
    </button>
  );
}

function SpotRow({ b }: { b: SpotBalance }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0">
      <span className="font-medium text-foreground">{b.coin}</span>
      <span className="flex items-baseline gap-3 tabular-nums text-sm">
        <span className="text-foreground">
          {b.total === null ? dash : b.total.toLocaleString("en-US", { maximumFractionDigits: 4 })}
        </span>
        {b.hold !== null && b.hold > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
            {b.hold.toLocaleString("en-US", { maximumFractionDigits: 2 })} held
          </span>
        )}
      </span>
    </li>
  );
}

export default function PositionsPanel({
  address,
  data,
  loading,
  error,
  onRetry,
}: {
  address: string | null;
  data: TraderSnapshot | null;
  loading: boolean;
  error: string | null;
  /** Re-runs the snapshot fetch for this address (useTrader's reload). */
  onRetry?: () => void;
}) {
  if (!address) {
    return (
      <Panel>
        <Legend>No trader selected</Legend>
        <p className="mt-2 text-sm text-muted">
          Pick a row on the leaderboard to inspect what that address is holding.
        </p>
      </Panel>
    );
  }

  if (loading && !data) {
    return (
      <Panel>
        <AddressLegend prefix="Reading " address={address} />
        <div className="mt-3 space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-card-hover" />
          ))}
        </div>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel>
        <AddressLegend prefix="Could not read " address={address} />
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--loss)]">
          {error}
        </p>
      </Panel>
    );
  }

  if (!data) return null;

  const { margin, positions, spot } = data;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <AddressLegend prefix="Perp account · " address={address} />
          {/* Labelled "perps" on purpose: the leaderboard's accountValue measures
              something different and the two disagree by orders of magnitude. */}
          <Legend>Perps only — differs from leaderboard equity</Legend>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Metric label="Account value">{money(margin?.accountValue ?? null)}</Metric>
          <Metric label="Notional open">{money(margin?.totalNtlPos ?? null)}</Metric>
          <Metric label="Margin used">{money(margin?.totalMarginUsed ?? null)}</Metric>
          <Metric label="Withdrawable">{money(margin?.withdrawable ?? null)}</Metric>
        </div>
      </Panel>

      <Panel>
        <Legend>
          {positions === null
            ? "Perp state unavailable"
            : `Open perp positions${positions.length > 0 ? ` · ${positions.length}` : ""}`}
        </Legend>
        {positions === null ? (
          <Unavailable
            reason="Upstream did not answer for this address"
            onRetry={onRetry}
            busy={loading}
          />
        ) : positions.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            This address holds no open perp positions right now. That is common among the
            top fifty — several rank on realised PnL and are currently flat.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {positions.map((p) => (
              <PositionCard key={p.coin} p={p} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <Legend>
          {spot === null
            ? "Spot balances unavailable"
            : `Spot balances${spot.length > 0 ? ` · ${spot.length}` : ""}`}
        </Legend>
        {spot === null ? (
          <Unavailable
            reason="Upstream did not answer for this address"
            onRetry={onRetry}
            busy={loading}
          />
        ) : spot.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No non-zero spot balances.</p>
        ) : (
          <ul className="mt-2">
            {spot.map((b) => (
              <SpotRow key={b.coin} b={b} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl border border-border bg-card p-4"
      style={{ borderTopColor: "var(--engrave-hi)" }}
    >
      {children}
    </section>
  );
}
