# Fleet management dashboard

Based on CPAMC v1.26.4; requires CLIProxyAPI v8. The quota route uses an
independently implemented layout inspired by Theo's public video at 15:35:
provider summaries, segmented quota bars, account ledger, provider tabs,
reset countdowns, and an explicit email visibility toggle. Ledger is the initial
view, with the original cards still available. Dark mode is the initial theme;
existing theme preferences remain respected. All summaries use actual loaded
provider data. Unloaded, stale and disabled credentials never become invented
available quota. No demo credentials or fabricated reset balances are shipped.

Existing OAuth flows, management authentication, refresh/reset actions,
quota session isolation, provider bodies and single-file deployment are retained.
No clients are routed through the gateway by this frontend.

Theo's private fork was not publicly available when checked on 2026-10-14.
This reproduces visible interface behavior, not his private source or scheduler.
The soonest-recovery control sorts the display; it does not change backend routing.

Verify with `bun run verify`, then inspect management.html#/quota in a browser.
