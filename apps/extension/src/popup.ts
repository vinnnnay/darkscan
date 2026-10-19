// Shows the visit so far. The wording matches the HTML report: potential patterns, with what the
// audit could not see stated next to them, so an empty list is never read as a clean bill of health.
import { coverage } from "@darkscan/report/render";
import { PATTERNS } from "@darkscan/schema/patterns";
import type { Finding } from "@darkscan/schema";
import { toRun, type Session } from "./session.ts";

const app = document.getElementById("app")!;
const esc = (text: unknown) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

type State = { watching: boolean; session: Session | null; findings: Finding[] };

const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const url = tab?.url ?? "";
const shoppable = /^https?:/.test(url);
const origin = shoppable ? new URL(url).origin : "";

function render(state: State) {
  const host = esc(origin.replace(/^https?:\/\//, ""));
  if (!state.watching) {
    app.innerHTML = `<h1>DarkScan</h1>
<p class="muted">Not watching ${host}.</p>
<div class="notice">Start an audit and shop as you normally would — open a product, add it to the cart, go to checkout. DarkScan reads the pages you visit and never clicks anything itself. Everything stays in this browser and is forgotten when you close it.</div>
<div class="row"><button class="primary" id="start">Audit this shop</button></div>
<p class="muted">It will ask for permission for ${host} only.</p>`;
    document.getElementById("start")!.addEventListener("click", async () => {
      const { started } = await chrome.runtime.sendMessage<{ started: boolean }>({ type: "start", origin, tabId: tab?.id });
      if (started) location.reload();
    });
    return;
  }

  const steps = state.session?.steps.length ?? 0;
  const findings = state.findings;
  const likely = findings.filter((f) => f.status === "likely").length;
  const cov = state.session ? coverage(toRun(state.session)) : { saw: [], missed: [] };

  app.innerHTML = `<h1>${host}</h1>
<p class="muted">${steps} page${steps === 1 ? "" : "s"} seen · ${likely} likely, ${findings.length - likely} to review</p>
${
    findings.length === 0
      ? `<div class="notice">Nothing found yet. Keep shopping: most of these patterns only show up once there is something in the cart and you reach checkout.</div>`
      : findings
          .map(
            (f) => `<div class="finding ${f.status}">
<h2>${esc(PATTERNS[f.pattern].name)} <span class="badge ${f.status}">${f.status === "likely" ? "Likely" : "Needs review"} · ${Math.round(f.confidence * 100)}%</span></h2>
<p>${esc(f.explanation)}</p></div>`,
          )
          .join("")
  }
<div class="notice"><strong>These are potential patterns, not a legal finding.</strong> Check the page yourself before acting on any of them.
${cov.missed.length ? `<ul>${cov.missed.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}</div>
<div class="row"><button id="stop">Stop and forget this visit</button></div>`;

  document.getElementById("stop")!.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "stop", origin, tabId: tab?.id });
    location.reload();
  });
}

if (!shoppable) {
  app.innerHTML = `<h1>DarkScan</h1><p class="muted">Open a shop's website, then click this icon to audit it.</p>`;
} else {
  render(await chrome.runtime.sendMessage<State>({ type: "state", origin }));
}
