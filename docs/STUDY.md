# Running a small study with real people

For the person collecting recordings. The point is a claim you can defend, such as "analysed N recorded sessions from
M volunteers across K shops", backed by evidence anyone can inspect.

## Before you start

- **Check whether you need approval.** If this is for coursework or research at your institute, ask whether collecting
  data from people needs ethics approval. Do that first; this document is not a substitute.
- **Adults only, and only volunteers.** No pressure, no rewards that make it hard to say no.
- **Never collect payment details.** The tool stops at payment on its own, but say so when you invite people.

## Invite people

Send [PARTICIPANT_GUIDE.md](PARTICIPANT_GUIDE.md) and ask for a clear yes. A message reply is enough, and keep it. Say
who will see the data (only you), that results are reported as totals, and that they can withdraw. Adapt this text:

> I'm testing a free tool that checks online shops for tricks the government has banned (fake countdowns, hidden fees,
> and so on). Would you shop on a site you normally use for about 10 minutes, with the tool watching? It doesn't save
> anything you type, and stops at the payment page. You'd send me a text-only copy that only I will see, under a code
> instead of your name, and I'll only ever report totals. You can stop any time or ask me to delete your copy. Is that OK?

## Handle the data carefully

- Keep each person's copy in a folder named by code (`P01`, `P02`, ...) inside one folder, for example `study/`. Keep a
  private note of who is which code, separate from the data.
- Prefer **text-only** copies (the default). Ask for screenshots only when you need to check a specific finding, and
  look at them before keeping them.
- Don't publish, post or share the raw copies. Delete a person's folder on request.
- You are trusting these folders as input from strangers. The tool validates them before use (`summarize` skips and
  names any that aren't valid), and reports escape everything they contain.

## Analyse

```bash
npm run summarize -- --dir study            # writes study/summary.md
npm run analyze -- --run study/P03          # one person's session, with a report you can open
```

`summary.md` counts, per shop, how many sessions showed each *potential* pattern. A session counts once per pattern.
Shops with fewer than 3 sessions are marked "too few to say anything general".

## Reading the results

- A count is a reason to **look at the evidence**, not a conclusion. Open the session's report and check the
  screenshots or text for each finding you care about.
- Check the "What this audit could not see" section: a session that never reached the cart says nothing about the cart.
- Several findings in the same session are often one cause.

## Publishing

- Report **totals** ("12 sessions, 5 shops, 7 sessions showed at least one potential pattern"). That is safe and honest.
- Don't name a shop alongside a pattern until a person has checked the evidence, at least 3 independent sessions agree,
  and you have given the shop a chance to respond. Use "potential", never "illegal". Take legal advice before naming anyone.
- The guidelines themselves say their examples "provide only guidance and shall not be construed as an interpretation
  of law or as a binding opinion". A forced account sign-up in particular may or may not count.
- Put real numbers on your resume, and only real ones.
