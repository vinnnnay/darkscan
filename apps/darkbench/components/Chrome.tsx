"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { PATTERNS } from "@darkscan/schema";
import { useStore } from "../lib/store.tsx";

export function Shell({ children }: { children: ReactNode }) {
  const { ready, cart, debug, patterns, decoys } = useStore();
  const pathname = usePathname();
  const count = cart.reduce((n, l) => n + l.qty, 0);
  return (
    <>
      <header className="header">
        <Link href="/" className="brand">
          DarkBench Store
        </Link>
        <Link href="/cart/" className="cart-link" data-testid="cart-link">
          Cart ({count})
        </Link>
      </header>
      {/* Render nothing until sessionStorage is read, so no page flashes the wrong variant. */}
      <main className="main">{ready ? children : null}</main>
      <footer className="footer">
        DarkBench is a test shop with deliberately planted dark patterns. Nothing here is for sale.
      </footer>
      {ready && debug && (
        <aside className="debug" aria-label="Active patterns">
          <strong>Planted:</strong> {patterns.length ? patterns.map((p) => PATTERNS[p].name).join(", ") : "none"}
          {decoys.length > 0 && (
            <>
              {" "}
              · <strong>Decoys:</strong> {decoys.join(", ")}
            </>
          )}
        </aside>
      )}
      {/* Keyed by route so the popup re-mounts on every client-side navigation. */}
      {ready && <NewsletterPopup key={pathname} />}
      {ready && <CookieConsent />}
    </>
  );
}

/** Nagging: when on, the popup returns on every page and 15s after each dismissal. When off, it shows once per session. */
function NewsletterPopup() {
  const { has, newsletterDismissed, update, words } = useStore();
  const nagging = has("nagging");
  const [open, setOpen] = useState(nagging || !newsletterDismissed);

  useEffect(() => {
    if (open || !nagging) return;
    const t = setTimeout(() => setOpen(true), 15_000);
    return () => clearTimeout(t);
  }, [open, nagging]);

  if (!open) return null;
  const close = () => {
    setOpen(false);
    update({ newsletterDismissed: true });
  };
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="nl-title">
      <div className="modal">
        <h2 id="nl-title">{words.newsletterTitle}</h2>
        <p>Join our newsletter for deals and new arrivals.</p>
        <input type="email" placeholder="you@example.com" aria-label="Email" />
        <DialogButtons
          accept="Subscribe"
          decline={has("confirm_shaming") ? words.newsletterShame : words.newsletterDecline}
          onAccept={close}
          onDecline={close}
        />
      </div>
    </div>
  );
}

/** cookie_consent decoy: shown once, with equal-weight Accept and Reject. Not a dark pattern. */
function CookieConsent() {
  const { decoy } = useStore();
  const [open, setOpen] = useState(() => {
    try {
      return !sessionStorage.getItem("darkbench:cookies");
    } catch {
      return true;
    }
  });
  if (!decoy("cookie_consent") || !open) return null;
  const close = () => {
    try {
      sessionStorage.setItem("darkbench:cookies", "1");
    } catch {}
    setOpen(false);
  };
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="cookie-title">
      <div className="modal">
        <h2 id="cookie-title">We use cookies</h2>
        <p>Cookies help us remember your cart and improve the site.</p>
        <div className="dialog-actions">
          <button className="btn" onClick={close}>
            Reject all
          </button>
          <button className="btn" onClick={close}>
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Interface interference: the accept button is loud and the decline option is a tiny
 * low-contrast link. When off, both are equal-weight buttons, or (link_decline decoy) the
 * decline is a plain but readable link.
 */
export function DialogButtons(props: { accept: string; decline: string; onAccept: () => void; onDecline: () => void }) {
  const { has, decoy } = useStore();
  if (has("interface_interference")) {
    return (
      <div className="dialog-actions stacked">
        <button className="btn btn-loud" onClick={props.onAccept}>
          {props.accept}
        </button>
        <button className="btn-faint" onClick={props.onDecline}>
          {props.decline}
        </button>
      </div>
    );
  }
  if (decoy("link_decline")) {
    return (
      <div className="dialog-actions">
        <button className="btn-link" onClick={props.onDecline}>
          {props.decline}
        </button>
        <button className="btn btn-primary" onClick={props.onAccept}>
          {props.accept}
        </button>
      </div>
    );
  }
  return (
    <div className="dialog-actions">
      <button className="btn" onClick={props.onDecline}>
        {props.decline}
      </button>
      <button className="btn btn-primary" onClick={props.onAccept}>
        {props.accept}
      </button>
    </div>
  );
}

/**
 * False urgency: a 10-minute "offer" timer that restarts on every page load, plus a
 * made-up stock claim. The real_countdown decoy instead counts down to midnight IST,
 * so it keeps going down across reloads.
 */
export function Urgency() {
  const { has, decoy, words } = useStore();
  const [now, setNow] = useState(() => Date.now());
  const [loadedAt] = useState(now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (has("false_urgency")) {
    const left = Math.max(0, 600 - Math.floor((now - loadedAt) / 1000));
    return (
      <div className="urgency">
        <span>
          {words.urgency} <span className="timer">{clock(left, false)}</span>
        </span>
        <span>{words.scarcity}</span>
      </div>
    );
  }
  if (decoy("real_countdown")) {
    const IST = 5.5 * 3600_000;
    const midnight = Math.ceil((now + IST) / 86_400_000) * 86_400_000 - IST;
    return (
      <div className="urgency calm">
        Sale ends in <span className="timer">{clock(Math.floor((midnight - now) / 1000), true)}</span>
      </div>
    );
  }
  return null;
}

function clock(seconds: number, withHours: boolean) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  return withHours ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m + h * 60)}:${pad(s)}`;
}
