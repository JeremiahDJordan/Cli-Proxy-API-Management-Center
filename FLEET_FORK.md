# Fleet management dashboard

Based on CPAMC v1.26.7 (branch `fleet`; the v1.26.4 version remains on `fleet-dashboard`);
requires CLIProxyAPI v8. The quota route uses an
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

Rebased 2026-10-26 onto v1.26.7. Upstream moved the Claude reset-grant details into
the card's plan items; the conflict in `QuotaCard.tsx` kept upstream's structure and
re-applied only the ledger body class. `bun run verify`: 1,660 tests passed, lint and
build passed. The fleet proxy plugin's scheduler view
(`/v0/management/fleet/status`) is not yet shown in this UI.

The dashboard's Gateway section shows the fork's live activity
(`/v0/management/fleet/activity`: requests, Responses WebSockets and turns in flight,
quiet/busy/draining) and the gate part of `/v0/management/fleet/status`: denial totals by
code and the last 50 denials (time, code, failed checks, provider/model, client user agent,
route, request ID, before/after selection). Accounts, scheduler picks and key lists stay out
of the UI; a client key appears only by its configured name. Both refresh every 15 s while
the page is visible. A gateway without these routes (404/501) shows a muted note and is not
polled again until a manual refresh.
