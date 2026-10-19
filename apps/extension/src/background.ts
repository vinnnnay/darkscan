// Keeps the audit for each shop and runs the detectors. Nothing is sent anywhere: the visit lives
// in session storage, which Chrome clears when the browser closes.
import type { Finding } from "@darkscan/schema";
import { addObservation, badgeFor, newSession, runRules, toRun, type Observation, type Session } from "./session.ts";

const key = (origin: string) => `visit:${origin}`;
const originOf = (url: string) => new URL(url).origin;

async function load(origin: string): Promise<Session | null> {
  const stored = await chrome.storage.session.get(key(origin));
  return (stored[key(origin)] as Session | undefined) ?? null;
}

async function save(session: Session) {
  await chrome.storage.session.set({ [key(session.origin)]: session });
}

async function badge(tabId: number | undefined, findings: Finding[]) {
  if (tabId === undefined) return;
  await chrome.action.setBadgeBackgroundColor({ color: "#b3261e", tabId });
  await chrome.action.setBadgeText({ text: badgeFor(findings), tabId });
  const likely = findings.filter((f) => f.status === "likely").length;
  await chrome.action.setTitle({ tabId, title: likely ? `DarkScan: ${likely} potential pattern(s) — click to read` : "DarkScan: watching this visit" });
}

/** Starting an audit is the person's decision, per shop, and it is what grants access to the site. */
async function start(origin: string, tabId?: number): Promise<boolean> {
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) return false;
  await chrome.scripting.unregisterContentScripts({ ids: [origin] }).catch(() => {});
  await chrome.scripting.registerContentScripts([
    { id: origin, matches: [`${origin}/*`], js: ["content.js"], runAt: "document_idle", persistAcrossSessions: false },
  ]);
  await save(newSession(origin, new Date().toISOString()));
  // A registered script only runs on the next load, and the person is looking at this page now.
  if (tabId !== undefined) await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
  return true;
}

async function stop(origin: string, tabId?: number) {
  await chrome.scripting.unregisterContentScripts({ ids: [origin] }).catch(() => {});
  await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => {});
  await chrome.storage.session.remove(key(origin));
  if (tabId !== undefined) await chrome.action.setBadgeText({ text: "", tabId });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  void (async () => {
    if (message?.type === "observe" && sender.tab?.url) {
      const origin = originOf(sender.tab.url);
      const session = await load(origin);
      // An observation from a shop whose audit was stopped is dropped rather than resurrecting it.
      if (!session) return respond({ ok: false });
      const next = addObservation(session, message.observation as Observation, new Date().toISOString());
      await save(next);
      const findings = runRules(toRun(next));
      await badge(sender.tab.id, findings);
      return respond({ ok: true, steps: next.steps.length, findings: findings.length });
    }
    if (message?.type === "state") {
      const session = await load(message.origin);
      const watching = (await chrome.scripting.getRegisteredContentScripts({ ids: [message.origin] })).length > 0;
      return respond({ watching, session, findings: session ? runRules(toRun(session)) : [] });
    }
    if (message?.type === "start") return respond({ started: await start(message.origin, message.tabId ?? sender.tab?.id) });
    if (message?.type === "stop") {
      await stop(message.origin, message.tabId);
      return respond({ stopped: true });
    }
    return respond({ ok: false });
  })();
  return true; // the reply is asynchronous
});
