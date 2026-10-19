# Real-site audit sweep

One run per shop on 2026-10-19, by `npm run sweep`. 2.5s between actions, `robots.txt` obeyed, a user
agent that names DarkScan, guest browsing only, no account ever created, and a stop before any payment control.
Navigation was rules only (no language model).

**10 of 15 shops could be audited at all; on 1 the agent walked the whole path to the point where an audit must stop — a checkout form, an account wall or a payment page.**

| Shop | Outcome | Steps | Ended on | Why it stopped |
|---|---|---|---|---|
| Amazon.in | Stopped early | 1 | listing | No rule fits this listing page, and no model is available. |
| Flipkart | Stopped early | 1 | listing | No rule fits this listing page, and no model is available. |
| Myntra | Not auditable | 1 | – | Not auditable: the site closed the connection (ERR_HTTP2_PROTOCOL_ERROR), which is typical of bot protection |
| Snapdeal | Path complete | 7 | payment | Reached payment: a payment page or a payment provider's checkout overlay. Audits stop before payment. |
| Nykaa | Not auditable | 1 | – | Not auditable: the site closed the connection (ERR_HTTP2_PROTOCOL_ERROR), which is typical of bot protection |
| Tata CLiQ | Stopped early | 3 | listing | No rule fits this listing page, and no model is available. |
| FirstCry | Stopped early | 6 | product | Stopped: robots.txt disallows https://checkout.firstcry.com/pay |
| Croma | Not auditable | 1 | – | Not auditable: HTTP 403: the site refused access |
| AJIO | Not auditable | 1 | – | Not auditable: HTTP 403: the site refused access |
| Reliance Digital | Stopped early | 3 | listing | Stopped: robots.txt disallows https://www.reliancedigital.in/collection/mobiles/?internal_source=navigation |
| boAt | Failed | 2 | product | page.reload: Timeout 60000ms exceeded. |
| Bewakoof | Stopped early | 1 | listing | No rule fits this listing page, and no model is available. |
| Lenskart | Failed | 1 | – | page.goto: Timeout 60000ms exceeded. |
| Decathlon | Stopped early | 16 | listing | Gave up after 14 actions. |
| Pepperfry | Not auditable | 1 | – | Not auditable: HTTP 403: the site refused access |

## Findings

Across every shop audited, the detectors raised **0 likely and 0 to-review potential findings**, in
0 of 10 shops.

**No finding here is attributed to a shop.** One automated run is not enough to say a named company uses a dark
pattern: a person has to check the evidence, independent runs have to agree, and the shop should get a chance to
respond first (see [docs/STUDY.md](../docs/STUDY.md)). The per-shop evidence — screenshots, steps, `report.html` —
stays in `runs/`, which is not committed.

A shop with no findings has not been cleared either. Read each report's "What this audit could not see" section:
a run that never reached the cart says nothing about the cart.
