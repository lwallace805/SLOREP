# Nemo, The Father, Gutenberg against the record, 2026-10-29

Sources. Seat curves from `src/data/pacingData.js` (all seats, rebuilt from
the order scan on 2026-09-16). Ticket mix, revenue and promo codes from
`report/marketing-scan/` (the deployed `/api/revenue-scan`, walked month by
month from 2024-05-19 to 2026-10-29 by `.github/workflows/marketing-scan.yml`).
Gutenberg figures are as of 2026-10-29, day 20 of a run that closes 11-08.

Two limits on the comparison set.

- Orders before the 2025-26 on-sale (May 2025) came into Spektrix as an
  import: one ticket type, no season-ticket lines, no offers. So sub/single
  split, comps by type and promo codes can only be compared against 2025-26.
- "Comp" is any seat with a zero price or a comp ticket type. "Sub" is a paid
  seat on an order that also bought a season ticket. "Single" is every other
  paid seat.

## 1. The three shows

### Finding Nemo (July 2026, 12 performances) against Seussical Jr. (July 2025, 10)

Both are the summer youth musical, outside the subscription (sub seats 40
and 45), same price points, same month.

| | Seussical 2025 | Nemo 2026 | change |
|---|---|---|---|
| Seats | 916 of 1,080 (84.8%) | 999 of 1,296 (77.1%) | +83 seats, fill down 7.7 pts |
| Paid | 809 | 835 | +3% |
| Comps | 107 (11.7%) | 164 (16.4%) | +57 |
| Paid revenue | $21,631 | $22,009 | +1.7% |
| Average paid price | $26.7 | $26.4 | |
| Paid seats sold before opening month | 29 (4%) | 372 (45%) | |
| Paid seats sold in opening month | 780 | 463 | |
| Promo tickets | 0 | 30 | |

What improved: the campaign moved buying forward by a month. Nemo had 354
paid seats on the books by the end of June; Seussical had 27 at the same
point. Revenue and paid seats both edged up.

What did not: demand did not grow with the inventory. Two added performances
(20% more seats) brought 3% more paid seats, so fill fell eight points and
the per-performance average fell from 92 to 83. The early buyers were, by and
large, the July buyers of last year arriving in June, not new ones on top.
Comps rose by half.

### The Father (Aug 2026, 14 performances) against Virginia Woolf (Mar 2026) and Lifespan of a Fact (May 2026)

The last two straight plays, same house, same 14 performances, same price list.

| | Woolf | Lifespan | The Father |
|---|---|---|---|
| Seats | 1,232 (81.5%) | 1,204 (79.6%) | 1,154 (82.2% of 1,404) |
| Paid | 1,006 | 1,008 | 959 |
| Comps | 226 (18.3%) | 196 (16.3%) | 195 (16.9%) |
| Sub seats | 441 | 453 | 470 |
| Single seats | 565 | 555 | 489 |
| Paid revenue | $41,100 | $40,967 | $39,516 |
| Average paid price | $40.9 | $40.6 | $41.2 |
| Promo tickets (discount) | 91 ($695) | 117 ($593) | 20 ($313) |
| Added day -31 to +16, all seats | 587 (38.8% of cap) | 569 (37.6%) | 578 (41.2%) |

Fill matched the peers; the mix underneath moved. The Father carried 6% more
subscription seats (the 26-27 base is larger, see section 2) and 12 to 13%
fewer single seats. Single-ticket revenue is the part marketing moves, and
on that count The Father came in about $3,000 under either spring play.

Timing cuts the other way. Woolf and Lifespan went on sale in May 2025 and
had ten months to accumulate singles before opening; The Father had four.
At day -60 The Father sat at 32.8% of capacity against 38 to 40% for the
spring plays, and it closed that gap by opening night (62.4% against 60.0 and
57.3). The campaign window added 41% of capacity, mid-pack among the eight
plays in the file (37.6 to 49.3). So the short runway cost early singles and
the campaign made it back; what it did not do is beat the spring plays'
single-ticket totals.

Where the Father singles landed by month of purchase: July 86, August 229,
September 157. Woolf's run-month singles were 255 and 173.

### Gutenberg! (Oct 2026, 24 performances, running) against I Love You, You're Perfect, Now Change (Aug 2025, 24)

Same house count, same price list, both four-weekend small-cast musicals.

| | ILYYPNC final | Gutenberg at day +20 |
|---|---|---|
| Seats | 1,916 (73.9%) | 1,793 (69.2%) |
| Paid | 1,695 | 1,479 |
| Comps | 221 (11.5%) | 314 (17.5%) |
| Sub seats | 463 | 500 |
| Single seats | 1,232 | 979 |
| Paid revenue | $74,190 | $63,858 |
| Average paid price | $43.8 | $43.2 |
| Single seats sold before opening month | 208 | 455 |
| Promo tickets (discount) | 134 ($670) | 59 ($740) |

At day +17 Gutenberg stood at 67.0% of capacity (live count 1,736 on 10-26).
The comparable four-weekend runs stood at 63.2 to 64.7% at the same point
(ILYYPNC, Musical of Musicals, Nunsense, Christmas Story 2025) and finished
at 72.7 to 76.5. They added 9 to 12 points of capacity from day +17 to
closing. Gutenberg should therefore close around 76 to 79% (1,970 to 2,050
seats), ahead of every four-weekend musical in the file except Beehive and
the two Million Dollar Quartets, with paid revenue in the $75,000 to $80,000
range against ILYYPNC's $74,190.

Same shape as Nemo: pre-opening-month singles more than doubled (455 against
208), the run itself is selling at about the peer rate, and comps are high.
314 comps already, 165 of them Artist Comps issued between 09-17 and 10-26,
against 221 for the whole of ILYYPNC.

### What the three have in common

1. Buying moved earlier. On all three shows, more single tickets were sold
   one to three months out than on the comparable show a year earlier. On
   Gutenberg that reads as a real gain (ahead of peers at day +17). On Nemo
   and The Father it mostly re-timed the same demand.
2. Comps run at 16 to 18% of seats, up from 11 to 12% on the autumn 2025
   shows. On a 14-performance play that is 60 to 80 seats, roughly one
   performance's worth. The dashboard's all-seats fill counts them, so a
   show can read as "matching last year" while paid seats are 5% down.
3. Promo codes are a smaller channel than last year (next section).
4. The subscription base grew, and it carried The Father's fill.

## 2. The subscription base

Mainstage season-ticket lines sold at the Mainstage price, by on-sale year:

| | 2025-26 | 2026-27 |
|---|---|---|
| Lines, May to September | 498 | 571, plus 20 flex packs |
| Comp lines | 39 | 46 |
| Revenue | $99,600 | $114,200 plus $3,160 flex |
| Sub seats per mainstage show | 440 to 463 | 470 to 505 |

Up about 15% in lines and 17% in dollars. Every 26-27 mainstage show opens
with roughly 500 subscriber seats in it against 450 last year, which is
worth remembering when a show's fill is read as a marketing result.

## 3. Promo codes

Offer ids are what Spektrix returns on each ticket; it does not expose the
code names through the API (every `/offers/{id}` lookup returns 404). The
first characters are given so they can be matched in Settings, Offers.

### Show-specific codes, 2025-26 to date

| Show | Code | Discount | Tickets | Discount given | Share of paid singles |
|---|---|---|---|---|---|
| ILYYPNC (Aug 2025) | 1AHG | $5 | 134 | $670 | 11% |
| Unnecessary Farce (Oct 2025) | 6AQN | $5 | 84 | $420 | 10% |
| | 7ALG | $10 | 13 | $130 | 1% |
| A Christmas Story (Nov 2025) | 4ACB | $5 | 176 | $880 | 11% |
| | 5ARQ | $10 | 30 | $300 | 2% |
| Million Dollar Quartet (Jan 2026) | 10AH, 11AR | $5, $10 | 5 | $40 | 0% |
| Virginia Woolf (Mar 2026) | 13AL | $5 | 41 | $205 | 7% |
| | 14AP | $10 | 48 | $480 | 8% |
| Lifespan of a Fact (May 2026) | 15AL | $5 | 113 | $565 | 20% |
| Grand Night for Singing (Jun 2026) | 16AG | $5 | 57 | $285 | 6% |
| | 17AN | $10 | 18 | $180 | 2% |
| Finding Nemo (Jul 2026) | 20AD | $10 | 6 | $60 | 1% |
| The Father (Aug 2026) | 24AJ | $15 | 18 | $270 | 4% |
| Gutenberg (Oct 2026, running) | 25AD | $10 | 34 | $340 | 3% |
| | 26AT | $10 | 11 | $110 | 1% |

A season-wide $5 code (9ANP) was used on 7 tickets across three shows in
January and February 2026.

Three things stand out.

- Redemptions fell by two thirds on the three shows marketed this season:
  20 to 59 tickets each against 89 to 134 on the comparable 2025-26 shows.
  The discount got deeper ($10 and $15 against $5) and use went down.
- Where a show had both a $5 and a $10 code, the $5 code was redeemed two to
  six times as often (Farce 84 against 13, Christmas Story 176 against 30,
  Grand Night 57 against 18). Woolf is the exception (41 against 48).
  Redemptions track how many people saw the code, not how much it is worth.
- The total discount given across all show codes since August 2025 is about
  $5,000 on roughly 790 tickets. The codes are a tracer of which audience a
  message reached, not a meaningful price lever.

### The 50% code (12AL)

First used in May 2026, applied to ten different productions, 69 tickets,
$1,315 of discount, average $19 off. By show: Nemo 24, Gutenberg 14, MDQ
Christmas 13, Grand Night 4, Forever Plaid 4, Three Tall Women 3, and one to
two each on Lifespan, Seminar, The Father and The Vertical Hour. By month:
May 5, June 15, July 20, August 3, September 2, October 24.

If this is the new-patron code, it has brought in on the order of 30 to 40
orders in six months, two thirds of them on Nemo, Gutenberg and MDQ
Christmas. Whether those households came back is the question the next
section is for.

## 4. New patrons and the email series: not yet measurable from here

The Spektrix API carries no email data. Opens, clicks and journey enrolment
live in Dotdigital (the email tool inside Spektrix) and are not reachable
from this connection. What Spektrix can answer is the behavioural half: of
the people whose first ever order landed after the series went live, how
many came back within 60 or 90 days, and how does that compare with the
people who first bought in the same months of 2025.

That needs the customer id on each order, which none of the dashboard's
routes keep. A new route, `/api/patron-scan`, is on this branch and does it
without letting a customer field out (it returns cohorts by month of first
purchase, repeat and second-show rates at 60 and 90 days, new customers per
show, and the same for buyers whose first order used a given offer). It
cannot run yet: the preview deployment has no Spektrix credentials, because
the three `SPEKTRIX_*` variables are set for Production only in Vercel.

To run it, either tick Preview on those three variables in the Vercel
project settings, or merge this branch to master. Then one call per 45 days
warms the cache and a single call reads the whole two years.

## Files

- `report/marketing-scan/events.tsv` and `events.json`: every event since
  May 2024 with tickets, comps, sub/single, type mix, revenue and offers,
  by month.
- `report/marketing-scan/raw.json`: the month-by-month scan, as returned.
- `scripts/marketing-scan/agg.mjs` and `.github/workflows/marketing-scan.yml`:
  rerun with `workflow_dispatch` to refresh.
- `src/app/api/patron-scan/route.js`: the cohort route, waiting on credentials.
