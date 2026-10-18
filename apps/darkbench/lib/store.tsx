"use client";

import type { PatternId } from "@darkscan/schema";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CartLine, PricingConfig } from "./pricing.ts";
import { DEFAULT_WORDS, configFromQuery, type DecoyId, type Words } from "./variants.ts";

type State = {
  patterns: PatternId[];
  decoys: DecoyId[];
  words: Words;
  cart: CartLine[];
  /** Ids the shopper explicitly removed, so sneaked add-ons aren't re-added on every visit. */
  removed: string[];
  newsletterDismissed: boolean;
  signedUp: boolean;
  debug: boolean;
  /** The ?v= / ?dp= query that chose this config, so revisiting the same link keeps the session. */
  configKey: string | null;
};

const INITIAL: State = {
  patterns: [],
  decoys: [],
  words: DEFAULT_WORDS,
  configKey: null,
  cart: [],
  removed: [],
  newsletterDismissed: false,
  signedUp: false,
  debug: false,
};
const STORAGE_KEY = "darkbench:state";

type Store = State & {
  ready: boolean;
  has: (p: PatternId) => boolean;
  decoy: (d: DecoyId) => boolean;
  pricing: PricingConfig;
  add: (id: string) => void;
  remove: (id: string) => void;
  update: (patch: Partial<State>) => void;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(INITIAL);
  const [ready, setReady] = useState(false);

  // State lives in sessionStorage so each crawler session starts clean. A ?v= or ?dp=
  // query starts a fresh session with that config, unless the session already runs it:
  // like any shop, revisiting the same link doesn't empty your cart.
  useEffect(() => {
    let next = INITIAL;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) next = { ...INITIAL, ...JSON.parse(saved) };
    } catch {}
    const params = new URLSearchParams(location.search);
    const configKey = params.has("dp") ? `dp=${params.get("dp")}` : params.has("v") ? `v=${params.get("v")}` : null;
    const fromQuery = configFromQuery(location.search);
    if (fromQuery && configKey !== next.configKey) next = { ...INITIAL, ...fromQuery, configKey };
    if (params.has("debug")) next = { ...next, debug: params.get("debug") !== "0" };
    setState(next);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state, ready]);

  const update = useCallback((patch: Partial<State>) => setState((s) => ({ ...s, ...patch })), []);

  const add = useCallback(
    (id: string) =>
      setState((s) => {
        const existing = s.cart.find((l) => l.id === id);
        const cart = existing
          ? s.cart.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l))
          : [...s.cart, { id, qty: 1 }];
        return { ...s, cart, removed: s.removed.filter((r) => r !== id) };
      }),
    [],
  );

  const remove = useCallback(
    (id: string) => setState((s) => ({ ...s, cart: s.cart.filter((l) => l.id !== id), removed: [...s.removed, id] })),
    [],
  );

  const value = useMemo<Store>(() => {
    const patternSet = new Set(state.patterns);
    const decoySet = new Set(state.decoys);
    return {
      ...state,
      ready,
      has: (p) => patternSet.has(p),
      decoy: (d) => decoySet.has(d),
      pricing: { patterns: patternSet, decoys: decoySet, words: state.words },
      add,
      remove,
      update,
    };
  }, [state, ready, add, remove, update]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <StoreProvider>");
  return store;
}
