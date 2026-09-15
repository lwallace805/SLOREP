# Audit: how ticket sales by show are pulled, 2026-09-15

## Three sources, three bases

1. Live seat count (`/events/{id}/availability`, Sold + Scanned). Every seat
   with a body in it, comps included. Feeds the By Performance page, the
   season rail, and the pacing page's live point. Only answers for events
   Spektrix still lists; a run more than a few days past closing returns
   nothing.
2. Order scan (`/orders?DateFrom&DateTo`, tickets on each order, bucketed by
   the order's first transaction date). Two bases: all seats, or net paid
   (comp ticket types and $0 line items excluded). Feeds the pacing curve,
   sales activity, and instance sales.
3. The data file `src/data/pacingData.js`, committed from a Spektrix export
   whose counting rule is not recorded anywhere. Every peer curve, every
   peer final, and the projection calibration rest on it.

## Where they agree

The Father, all seats, order scan from first order to closing night: 1,154.
Live seat count: 1,154. Exact. Net paid on the same scan: 1,009 (145 non-paid
seats). So the order scan is trustworthy on the all-seats basis where Spektrix
can be checked against it, and the two figures the pacing page and By
Performance show are the same data on two bases, not a discrepancy.

## Where the data file disagrees with the scan

Rebuilt from orders with the fixed scan, first order to closing night:

| Show | Perfs | Cap | Scan all seats | Scan net paid | Data file final |
|---|---|---|---|---|---|
| Misery (2024-10-11) | 14 | 1,512 | 1,293 (85.5%) | 1,150 (76.1%) | 1,200 (79.4%) |
| Who's Afraid of Virginia Woolf (2026-03-27) | 14 | 1,512 | 1,232 (81.5%) | not run | 1,358 (89.8%) |
| The Lifespan of a Fact (2026-05-01) | 14 | 1,512 | 1,204 (79.6%) | not run | 1,360 (89.9%) |

Performance counts and the 108-seat plan (55 centre, 23 left, 26 right, 4
director's) come from Spektrix for each run, so the 1,512 capacities are
right. No Misery, Woolf or Lifespan ticket sits on an order dated before the
scan windows (checked back to January of each on-sale year).

The data file sits above the all-seats scan for the two 25-26 shows and
between the two bases for Misery. Neither base reproduces it, so it was not
produced by either rule this code uses. Until whoever made the export says
what it counted, peer comparisons on the pacing page carry an unknown
offset of roughly plus or minus 10% of a final.

## Kevin's Misery figure

Spektrix's orders put Misery at 1,293 seats of 1,512 (85.5%) with comps, or
1,150 (76.1%) net paid. The data file says 1,200 (79.4%). None of the three
reaches 90%. Spektrix has zeroed the per-performance seat status for a run
that old, so there is no fourth source to check against. If Kevin's figure
comes from a Spektrix report, that report's definition (gross of returns and
exchanges, or a different capacity) is the thing to compare, not the scan.

## Known limits of the order scan

- Tickets are dated by the order's first transaction, not by when each ticket
  was added. A subscription order renewed in May whose show tickets were
  allocated in September puts those seats on the curve in May.
- It counts the order's current tickets, so it is net of returns and
  exchanges. A report that counts gross sales will read higher.
- The 2026-07-08..07-11 window returns the same orders on every page from
  Spektrix; the scan now recognises a page that adds nothing and stops.

## Fixes shipped today (all on master and production)

- Scan pages every window to its end; reports every unfinished window.
- comps flag honoured; comps counted in net paid scans so the live figure can
  be netted; closing point on closing night; optional toDate.
- Closed shows keep their measured curve through closing night; presale-only
  export points are replaced by the scan.
- Closed shows resolve through the orders around their opening; a past run's
  performances and plan seat count are listed under /api/instances.

## What is still open

- The pacing page defaults to net paid; By Performance and the rail are all
  seats. Same data, two bases. Defaulting the pacing page to all seats makes
  the pages agree and matches what Spektrix reports, at the cost of running
  the projection against peer curves whose basis is unknown either way.
- The data file should be regenerated from the order scan on one stated
  basis, with capacities from Spektrix, so peers and the current show are
  measured the same way. `scripts/report-campaign-window.mjs` already walks
  a show; the remaining work is writing the result into `pacingData.js`.
