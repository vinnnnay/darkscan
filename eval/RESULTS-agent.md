# DarkBench results (rules only)

## Recipe agent (rules only)

- Reached checkout, an account wall or payment, with no hand-written recipe: **50/50**
- Recipe length: 8–9 steps; model decisions: 0
- Recipes that replay to identical findings: **50/50**

## dev split (25 variants)

Variants 0–24, wording the detectors may be tuned on. Detectors: rules only. Only "likely" findings count as detections.

| Pattern | Precision | Recall | TP | FP | FN | TN | Review |
|---|---|---|---|---|---|---|---|
| Drip pricing | 100.0% | 42.9% | 6 | 0 | 8 | 11 | 0 |
| Basket sneaking | 100.0% | 69.2% | 9 | 0 | 4 | 12 | 0 |
| False urgency | 100.0% | 100.0% | 11 | 0 | 0 | 14 | 0 |
| Interface interference | 100.0% | 100.0% | 15 | 0 | 0 | 10 | 0 |
| Nagging | 100.0% | 100.0% | 7 | 0 | 0 | 18 | 0 |
| Forced action | 100.0% | 100.0% | 10 | 0 | 0 | 15 | 0 |
| Bait and switch | 100.0% | 100.0% | 12 | 0 | 0 | 13 | 8 |
| **All rule detectors** | **100.0%** | **85.4%** | 70 | 0 | 12 | | |

## test split (25 variants)

Variants 25–49, held-out wording the detectors are never tuned on. Detectors: rules only. Only "likely" findings count as detections.

| Pattern | Precision | Recall | TP | FP | FN | TN | Review |
|---|---|---|---|---|---|---|---|
| Drip pricing | 100.0% | 72.7% | 8 | 0 | 3 | 14 | 0 |
| Basket sneaking | 100.0% | 83.3% | 10 | 0 | 2 | 13 | 0 |
| False urgency | 100.0% | 25.0% | 3 | 0 | 9 | 13 | 0 |
| Interface interference | 100.0% | 100.0% | 9 | 0 | 0 | 16 | 0 |
| Nagging | 100.0% | 100.0% | 11 | 0 | 0 | 14 | 0 |
| Forced action | – | 0.0% | 0 | 0 | 5 | 20 | 0 |
| Bait and switch | 100.0% | 100.0% | 10 | 0 | 0 | 15 | 10 |
| **All rule detectors** | **100.0%** | **72.9%** | 51 | 0 | 19 | | |
