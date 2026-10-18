"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OrderSummary } from "../../components/OrderSummary.tsx";
import { findItem } from "../../lib/catalog.ts";
import { useStore } from "../../lib/store.tsx";

const SNEAKED_ID = "purchase-protection";
const FREE_GIFT_ID = "free-sample";

export default function CheckoutPage() {
  const { cart, has, decoy, add, remove, removed, signedUp, update, words } = useStore();
  const [guest, setGuest] = useState(false);

  // Basket sneaking: an add-on the shopper never chose appears once they reach checkout.
  // The free_gift decoy adds a ₹0 sample the same way, which costs the shopper nothing.
  const sneak = has("basket_sneaking") && cart.length > 0 && !removed.includes(SNEAKED_ID);
  const gift = decoy("free_gift") && cart.length > 0 && !removed.includes(FREE_GIFT_ID);
  useEffect(() => {
    if (sneak && !cart.some((l) => l.id === SNEAKED_ID)) add(SNEAKED_ID);
    if (gift && !cart.some((l) => l.id === FREE_GIFT_ID)) add(FREE_GIFT_ID);
  }, [sneak, gift, cart, add]);

  if (cart.length === 0) {
    return (
      <>
        <h1>Nothing to check out</h1>
        <Link href="/">Continue shopping</Link>
      </>
    );
  }

  // Forced action: an account is mandatory, with no guest option. The signin_prompt
  // decoy uses the same pushy heading but still offers guest checkout.
  if (!signedUp && !guest) {
    const forced = has("forced_action");
    return (
      <section className="narrow">
        <h1>{forced || decoy("signin_prompt") ? words.accountWall : "How would you like to check out?"}</h1>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            update({ signedUp: true });
          }}
        >
          <input type="email" required placeholder="Email" aria-label="Email" />
          <input type="password" required placeholder="Password" aria-label="Password" />
          <button className="btn" type="submit">
            Create account
          </button>
        </form>
        {!forced && (
          <button className="btn btn-primary" onClick={() => setGuest(true)}>
            {words.guest}
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="narrow">
      <h1>Checkout</h1>
      <form className="form" onSubmit={(e) => e.preventDefault()}>
        <input placeholder="Full name" aria-label="Full name" />
        <input placeholder="Address" aria-label="Address" />
        <input placeholder="PIN code" aria-label="PIN code" inputMode="numeric" />
        <TrickQuestion />
      </form>

      <h2>Order summary</h2>
      <ul className="cart" data-testid="checkout-items">
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
      <OrderSummary stage="checkout" />
      <Link href="/payment/" className="btn btn-primary">
        Proceed to payment
      </Link>
    </section>
  );
}

/** Trick question: a pre-ticked, confusingly worded opt-out. When off, a plain unticked opt-in. */
function TrickQuestion() {
  const { has, words } = useStore();
  const trick = has("trick_question");
  const [checked, setChecked] = useState(trick);
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
      {trick ? words.trick : words.optIn}
    </label>
  );
}
