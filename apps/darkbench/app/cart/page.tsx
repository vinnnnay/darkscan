"use client";

import Link from "next/link";
import { useState } from "react";
import { DialogButtons } from "../../components/Chrome.tsx";
import { OrderSummary } from "../../components/OrderSummary.tsx";
import { ADDONS, findItem, inr } from "../../lib/catalog.ts";
import { useStore } from "../../lib/store.tsx";

export default function CartPage() {
  const { cart, has, add, remove, words } = useStore();
  const plan = ADDONS["protection-plan"]!;
  const [offerOpen, setOfferOpen] = useState(() => cart.length > 0 && !cart.some((l) => l.id === plan.id));

  if (cart.length === 0) {
    return (
      <>
        <h1>Your cart is empty</h1>
        <Link href="/">Continue shopping</Link>
      </>
    );
  }

  return (
    <>
      <h1>Your cart</h1>
      <ul className="cart" data-testid="cart-items">
        {cart.map((l) => (
          <li key={l.id}>
            <span>
              {findItem(l.id)?.name} × {l.qty}
            </span>
            <button className="btn-link" onClick={() => remove(l.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <OrderSummary stage="cart" />
      <Link href="/checkout/" className="btn btn-primary">
        Proceed to checkout
      </Link>

      {/* A normal upsell. It only becomes a dark pattern through the button styling and wording. */}
      {offerOpen && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="upsell-title">
          <div className="modal">
            <h2 id="upsell-title">Protect your purchase?</h2>
            <p>
              Add the {plan.name} for {inr(plan.price)}. Covers accidental damage.
            </p>
            <DialogButtons
              accept="Add protection"
              decline={has("confirm_shaming") ? words.upsellShame : words.upsellDecline}
              onAccept={() => {
                add(plan.id);
                setOfferOpen(false);
              }}
              onDecline={() => setOfferOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
