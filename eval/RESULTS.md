# DarkBench results (rules only)

## dev split (25 variants)

Variants 0–24, wording the detectors may be tuned on. Detectors: rules only. Only "likely" findings count as detections.

| Pattern | Precision | Recall | TP | FP | FN | TN | Review |
|---|---|---|---|---|---|---|---|
| Drip pricing | 100.0% | 100.0% | 14 | 0 | 0 | 11 | 0 |
| Basket sneaking | 100.0% | 100.0% | 13 | 0 | 0 | 12 | 0 |
| False urgency | 100.0% | 100.0% | 11 | 0 | 0 | 14 | 0 |
| Interface interference | 100.0% | 100.0% | 15 | 0 | 0 | 10 | 0 |
| Nagging | 100.0% | 100.0% | 7 | 0 | 0 | 18 | 0 |
| Forced action | 100.0% | 100.0% | 10 | 0 | 0 | 15 | 0 |
| Bait and switch | 100.0% | 100.0% | 12 | 0 | 0 | 13 | 8 |
| **All rule detectors** | **100.0%** | **100.0%** | 82 | 0 | 0 | | |

## test split (25 variants)

Variants 25–49, held-out wording the detectors are never tuned on. Detectors: rules only. Only "likely" findings count as detections.

| Pattern | Precision | Recall | TP | FP | FN | TN | Review |
|---|---|---|---|---|---|---|---|
| Drip pricing | 100.0% | 100.0% | 11 | 0 | 0 | 14 | 0 |
| Basket sneaking | 100.0% | 100.0% | 12 | 0 | 0 | 13 | 0 |
| False urgency | 100.0% | 25.0% | 3 | 0 | 9 | 13 | 0 |
| Interface interference | 100.0% | 100.0% | 9 | 0 | 0 | 16 | 0 |
| Nagging | 100.0% | 100.0% | 11 | 0 | 0 | 14 | 0 |
| Forced action | – | 0.0% | 0 | 0 | 5 | 20 | 0 |
| Bait and switch | 100.0% | 100.0% | 10 | 0 | 0 | 15 | 10 |
| **All rule detectors** | **100.0%** | **80.0%** | 56 | 0 | 14 | | |
