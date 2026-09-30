# Independent arithmetic and capacity crosscheck — October 1, 2026

Audit scope: saved research inputs and outputs, without importing the replay implementation or calling the broker. This validates arithmetic and observed-entry capacity conflicts. It does not validate hypothetical fills or turn a fixed-entry study into a strategy/portfolio backtest.

## Checks

- All 29 actual SELL trade P&Ls reconcile between the current API snapshot and broker realized P&L plus financing. Entry price, close price and absolute initial units agree.
- All 928 scenario rows pass independent Decimal-based price rounding, integer-unit sizing, nominal stop-risk, target, breakeven, cash-proxy and R calculations. All 288 aggregates recompute correctly.
- Resized nominal stop risk is 98.7089%–100% of the corresponding original broker-stop risk. Flooring integer units accounts for the reduction. This is nominal stop risk, not a guarantee against gap/slippage losses.
- Saved baseline exit classes agree with actual classifications for 29/29 trades. This is a class check, not a fill-time/price reproduction.
- Poll phases 0 and 5 seconds have identical exit-kind/price sets across all 29 trades and both widening families. These two sampled phases do not establish that every possible monitor schedule has identical results.
- Recent 13 actual SELL trades: 2 positive, 10 negative and 1 zero; net **−A$0.8769**. Earlier 16: 7 positive, 8 negative and 1 zero; net **+A$0.0735**. All 29 net **−A$0.8034**.

## Individual conditional cash proxies

Amounts below are A$ proxies using entry-time conversion and reduced units. “Fixed” retains the original absolute target and breakeven trigger. “Scaled” moves both with the wider risk unit. The 10-second phase-0 scenario is displayed; phase-5 has the same price outcomes. Multiple possible prices appear as a range. Costs/slippage/conversion changes in hypothetical executions are excluded.

| Trade | Pair | Actual A$ | Fixed 1.25× | Fixed 1.5× | Fixed 2× | Scaled 1.25× | Scaled 1.5× | Scaled 2× |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 3073 | USD/JPY | +0.2637 | +0.2107 | +0.1751 | +0.1317 | +0.2622 | +0.2627 | +0.2627 |
| 3085 | USD/JPY | +0.2693 | +0.2120 | +0.1761 | +0.1316 | +0.2633 | +0.0000 | +0.2626 |
| 3097 | USD/JPY | +0.2694 | +0.2142 | +0.1785 | +0.1333 | +0.2673 | +0.2677 | +0.2665 |
| 3109 | USD/JPY | +0.0219 | +0.0155 | +0.0129 | +0.0098 | +0.0155 | +0.0129 | +0.0098 |
| 3121 | USD/JPY | +0.2784 | +0.2197 | +0.1831 | +0.1386 | +0.2752 | +0.2755 | +0.2782 |
| 3133 | USD/JPY | -0.1926 | -0.1879 | -0.1881 | -0.1869 | -0.1879 | -0.1881 | -0.1869 |
| 3143 | USD/JPY | -0.1814 | -0.1795 | -0.1801 | -0.1816 | -0.1795 | -0.1801 | -0.1816 |
| 3153 | USD/JPY | -0.1812 | -0.1806 | -0.1807 | -0.1798 | -0.1806 | -0.1807 | -0.1798 |
| 3163 | EUR/USD | +0.1150 | +0.0860 | +0.0719 | +0.0543 | +0.0860 | +0.0719 | +0.0543 |
| 3185 | USD/JPY | -0.1577 | -0.1565 | -0.1564 | -0.1565 | -0.1565 | -0.1564 | -0.1565 |
| 3195 | AUD/USD | +0.2297 | +0.1832 | +0.1521 | +0.1147 | +0.2280 | +0.2281 | +0.2294 |
| 3207 | AUD/USD | -0.1604 | +0.1885 | +0.1573 | +0.1173 | +0.2346 | +0.2359 | +0.2347 |
| 3229 | EUR/USD | -0.1682 | -0.1682 | -0.1669 | -0.1683 | -0.1682 | -0.1669 | -0.1683 |
| 3239 | AUD/USD | +0.0000 | +0.0000 | +0.0000 | +0.0000 | -0.1142 to -0.1120 | -0.0954 to -0.0936 | -0.0714 to -0.0700 |
| 3251 | AUD/USD | -0.1701 | -0.1703 | -0.1698 | -0.1703 | -0.1703 | -0.1698 | -0.1703 |
| 3307 | AUD/USD | -0.1623 | -0.1616 | -0.1620 | -0.0889 | -0.1616 | -0.1620 | -0.0889 |
| 3347 (recent) | AUD/USD | -0.1619 | -0.1618 | +0.1563 | +0.1179 | -0.1618 | +0.0000 | -0.0706 to -0.0693 |
| 3357 (recent) | EUR/USD | +0.0000 | +0.0000 | +0.0000 | +0.0000 | -0.1770 | -0.1764 | -0.1775 |
| 3369 (recent) | AUD/USD | +0.2585 | +0.2010 | +0.1683 | +0.1256 | +0.2501 | +0.2525 | +0.2513 |
| 3381 (recent) | EUR/USD | +0.2718 | +0.2143 | +0.1783 | +0.1347 | +0.0000 | +0.0000 | +0.2693 |
| 3393 (recent) | EUR/USD | -0.1841 | -0.1823 | -0.1823 | +0.1335 | -0.1823 | -0.1823 | +0.0146 |
| 3413 (recent) | EUR/USD | -0.0469 | -0.0413 | -0.0344 | -0.0258 | -0.0413 | -0.0344 | -0.0258 |
| 3425 (recent) | AUD/USD | -0.1615 | -0.1224 | -0.1018 | -0.0764 | -0.1224 | -0.1018 | -0.0764 |
| 3435 (recent) | AUD/USD | -0.1399 | -0.1394 | -0.1400 | -0.1400 | -0.1394 | -0.1400 | -0.1400 |
| 3445 (recent) | USD/JPY | -0.1850 | -0.0953 | -0.0804 | -0.0595 | -0.0953 | -0.0804 | -0.0595 |
| 3455 (recent) | USD/JPY | -0.1794 | -0.1784 | -0.1789 | -0.1781 | -0.1784 | -0.1789 | -0.1781 |
| 3465 (recent) | USD/JPY | -0.1716 | -0.1698 | -0.1687 | -0.1709 | -0.1698 | -0.1687 | -0.1709 |
| 3475 (recent) | USD/JPY | -0.0011 | +0.0000 | +0.0000 | +0.0000 | -0.1754 | -0.1761 | -0.1747 |
| 3487 (recent) | AUD/USD | -0.1758 | +0.1632 | +0.1339 | +0.1018 | +0.1632 | +0.1339 | +0.1018 |

## Observed next entries incompatible with extended holds

Each arrow means: **if the left-hand trade were still open in that scenario, the actual right-hand entry could not occur at its recorded time under the historical capacity rule**. Every listed overlap is definite within both modeled poll-phase exit-time bounds. This does not recursively select a valid alternate portfolio or infer replacement entries.

Historical releases through v4 had one global position. v4.1/v4.2 have one per pair. In particular, 3393→3403 blocks a different-pair BUY under the historical global cap; 3455→3465 blocks the same USD/JPY pair under v4.1.

| Cohort | Family | Stop multiplier | Incompatible observed entries |
|---|---|---:|---|
| Recent 13 | fixed | 1.25× | 3425→3435 |
| Recent 13 | fixed | 1.5× | 3347→3357, 3425→3435 |
| Recent 13 | fixed | 2× | 3347→3357, 3393→3403, 3425→3435, 3455→3465 |
| Recent 13 | scaled | 1.25× | 3381→3393, 3425→3435 |
| Recent 13 | scaled | 1.5× | 3347→3357, 3381→3393, 3425→3435 |
| Recent 13 | scaled | 2× | 3347→3357, 3381→3403, 3381→3393, 3393→3413, 3393→3403, 3425→3435, 3455→3465 |
| Earlier 16 | fixed | 1.25× | None |
| Earlier 16 | fixed | 1.5× | 3143→3153 |
| Earlier 16 | fixed | 2× | 3143→3153 |
| Earlier 16 | scaled | 1.25× | 3073→3085, 3239→3251 |
| Earlier 16 | scaled | 1.5× | 3073→3085, 3143→3153, 3195→3207, 3207→3217, 3239→3251 |
| Earlier 16 | scaled | 2× | 3073→3085, 3085→3097, 3121→3133, 3143→3153, 3195→3207, 3207→3217, 3239→3251 |

## Reproduction and limits

Run `python3 crosscheck.py` in this directory. Retained `crosscheck_inputs.json` contains the relevant minimal API fields including BUY entries, with a SHA-256 of the original raw snapshot. To regenerate that reduced input, pass the raw trades API JSON path as the first argument. `crosscheck.json` records full checks, original input hashes, all 29 tables, recent 13 tables and both poll-phase conflict lists.

No counterfactual signal, cooldown, H1 reset or new-entry regeneration is attempted. Capacity alone is sufficient to reject a portfolio-return interpretation of summed fixed-fill scenarios. The arithmetic checks do not remove the replay's stated S5 aggregation, broker-trigger/fill and hypothetical polling limitations.
