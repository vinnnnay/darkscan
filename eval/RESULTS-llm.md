# DarkBench results (rules + qwen2.5:3b via Ollama)

## dev split (25 variants)

Variants 0–24, wording the detectors may be tuned on. Detectors: rules + qwen2.5:3b via Ollama. Only "likely" findings count as detections.

| Pattern | Precision | Recall | TP | FP | FN | TN | Review |
|---|---|---|---|---|---|---|---|
| Drip pricing | 100.0% | 100.0% | 14 | 0 | 0 | 11 | 0 |
| Basket sneaking | 100.0% | 100.0% | 13 | 0 | 0 | 12 | 0 |
| False urgency | 100.0% | 100.0% | 11 | 0 | 0 | 14 | 0 |
| Interface interference | 100.0% | 100.0% | 15 | 0 | 0 | 10 | 0 |
| Nagging | 100.0% | 100.0% | 7 | 0 | 0 | 18 | 0 |
| Forced action | 100.0% | 100.0% | 10 | 0 | 0 | 15 | 0 |
| Bait and switch | 100.0% | 100.0% | 12 | 0 | 0 | 13 | 8 |
| Confirm shaming | 100.0% | 100.0% | 8 | 0 | 0 | 17 | 0 |
| Trick question | 100.0% | 100.0% | 15 | 0 | 0 | 10 | 0 |
| Disguised advertisement | 100.0% | 100.0% | 7 | 0 | 0 | 18 | 0 |
| **All rule detectors** | **100.0%** | **100.0%** | 112 | 0 | 0 | | |

## test split (25 variants)

Variants 25–49, held-out wording the detectors are never tuned on. Detectors: rules + qwen2.5:3b via Ollama. Only "likely" findings count as detections.

| Pattern | Precision | Recall | TP | FP | FN | TN | Review |
|---|---|---|---|---|---|---|---|
| Drip pricing | 100.0% | 100.0% | 11 | 0 | 0 | 14 | 0 |
| Basket sneaking | 100.0% | 100.0% | 12 | 0 | 0 | 13 | 0 |
| False urgency | 100.0% | 58.3% | 7 | 0 | 5 | 13 | 0 |
| Interface interference | 100.0% | 100.0% | 9 | 0 | 0 | 16 | 0 |
| Nagging | 100.0% | 100.0% | 11 | 0 | 0 | 14 | 0 |
| Forced action | 100.0% | 20.0% | 1 | 0 | 4 | 20 | 0 |
| Bait and switch | 100.0% | 100.0% | 10 | 0 | 0 | 15 | 10 |
| Confirm shaming | 54.5% | 85.7% | 6 | 5 | 1 | 13 | 0 |
| Trick question | 100.0% | 100.0% | 13 | 0 | 0 | 12 | 0 |
| Disguised advertisement | 71.4% | 100.0% | 10 | 4 | 0 | 11 | 0 |
| **All rule detectors** | **90.9%** | **90.0%** | 90 | 9 | 10 | | |
