# The Father: campaign-window numbers from the order scan

Scan run 2026-09-15 against production (`/api/history-fill`, commit 0fa70d4),
from the first order carrying a Father ticket (2026-05-05) through 2026-09-15,
baseline 0. Opening night 2026-08-28. Every window paged to its end except
2026-07-08..2026-07-11, which Spektrix answers with the same ~206 orders on
every page; scanning each of those four days on its own gives the same 29
tickets the window's first page gives, so nothing is missing from it.

## Net paid (comps and $0 line items excluded)

| | |
|---|---|
| Cumulative on 2026-07-27 (day -32, day before first campaign email) | 565 |
| Added 2026-07-28 through 2026-09-13 (day -31 through +16) | 444 |
| Final cumulative, 2026-09-15 | 1,009 |

## All seats (comps and $0 line items included)

| | |
|---|---|
| Cumulative on 2026-07-27 (day -32) | 576 |
| Added 2026-07-28 through 2026-09-13 (day -31 through +16) | 578 |
| Final cumulative, 2026-09-15 | 1,154 |

The all-seats final matches the live seat count (1,154 of 1,404) exactly.
The net-paid final is 1,009, below the 1,103 you get by subtracting the 51
comps the By Performance view shows, because that view only scans its last
30 days: over the show's whole life the scan finds 145 non-paid seats (comp
ticket types plus $0 line items).

## Where the 171 "missing" tickets were

None were lost to the page cap. The 2026-07-08..07-11 window was reported as
hitting the 8-page ceiling, but pages 2 onward repeat page 1: 3,502 orders
returned across 17 pages, 206 unique. The old scan already had every Father
ticket on orders dated 2026-06-02 onward (952, the same figure the fixed scan
finds for that stretch).

| Component | Before 2026-07-28 | On or after 2026-07-28 | Total |
|---|---|---|---|
| Non-paid seats the net-paid rule excludes | 11 | 134 | 145 |
| Tickets sold before 2026-06-02 that the export baseline (31) did not carry | 26 | 0 | 26 |
| Lost to the page cap | 0 | 0 | 0 |
| | 37 | 134 | 171 |

So on the old basis (export baseline 31 plus the scan from 2026-06-02), the
2026-07-27 cumulative was 539 net paid. The scan from the first order puts it
at 565 net paid or 576 all seats.

## Baked series baseline

The export's seven presale points for The Father run at roughly half the
scan's ticket count at every one of them (2 vs 4, 4 vs 8, 6 vs 10, 24 vs 44,
31 vs 57), which reads like an order count rather than a ticket count. The
completed shows' baked finals (Misery 1,200 of 1,512) cannot be order counts,
so The Father's presale points were produced on a different basis from the
comparison series and should not be spliced onto the scan.

## Comparison shows

Not rebuilt. The baked series for Misery, The Cake, Who's Afraid of Virginia
Woolf, I Hate Hamlet and The Lifespan of a Fact did not come from this scan
(there is no generator in the repo; the data file was committed from a
Spektrix export), so they do not carry a page-cap hole, and no final has
changed. Rebuilding them from orders is currently blocked anyway: the route
resolves a show by name through Spektrix's `/events` listing, which returns
only the 13 events with performances still to come, so a closed show comes
back "Event not found". Their day -32 and -31..+16 figures from the baked
series are:

| Show | Cumulative at day -32 | Added day -31 through +16 | Final |
|---|---|---|---|
| Misery (2024-10-11) | 519 | 681 | 1,200 |
| The Cake (2025-03-28) | 539 | 520 | 1,059 |
| Who's Afraid of Virginia Woolf (2026-03-27) | 712 | 644 | 1,358 |
| I Hate Hamlet (2025-05-02) | 526 | 576 | 1,102 |
| The Lifespan of a Fact (2026-05-01) | 699 | 661 | 1,360 |

Whether those series count net paid or all seats is not recorded anywhere in
the repo, and it changes which Father column they line up against.

## Files

- `the-father-net-paid.csv`: date, days_to_opening, cumulative, daily_added
- `the-father-all-seats.csv`: the same, comps and $0 line items included
