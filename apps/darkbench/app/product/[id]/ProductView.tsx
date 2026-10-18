"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Urgency } from "../../../components/Chrome.tsx";
import { PRODUCTS, inr } from "../../../lib/catalog.ts";
import { FREE_SHIPPING_MIN, PLATFORM_FEE, SHIPPING_FEE } from "../../../lib/pricing.ts";
import { useStore } from "../../../lib/store.tsx";

export function ProductView({ id }: { id: string }) {
  const { has, decoy, add, words } = useStore();
  const router = useRouter();
  const product = PRODUCTS.find((p) => p.id === id)!;
  const switchTo = PRODUCTS.find((p) => p.id === "earbuds-pro")!;

  // Bait and switch: the advertised deal is never actually available.
  if (product.bait && has("bait_and_switch")) {
    return (
      <article className="product">
        <span className="icon big" aria-hidden>
          {product.icon}
        </span>
        <div>
          <h1>{product.name}</h1>
          <p className="price">{inr(product.price)}</p>
          <p className="oos">{words.unavailable}</p>
          <p>
            Customers also loved <strong>{switchTo.name}</strong> at {inr(switchTo.price)}.
          </p>
          <Link href={`/product/${switchTo.id}/`} className="btn btn-primary">
            Buy {switchTo.name} instead
          </Link>
        </div>
      </article>
    );
  }

  // honest_stockout decoy: the deal is genuinely gone, and nothing else is pushed.
  if (product.bait && decoy("honest_stockout")) {
    return (
      <article className="product">
        <span className="icon big" aria-hidden>
          {product.icon}
        </span>
        <div>
          <h1>{product.name}</h1>
          <p className="price">{inr(product.price)}</p>
          <p className="oos">{words.unavailable}</p>
          <button className="btn">Notify me when it is back</button>
        </div>
      </article>
    );
  }

  return (
    <article className="product">
      <span className="icon big" aria-hidden>
        {product.icon}
      </span>
      <div>
        <h1>{product.name}</h1>
        <p>{product.blurb}</p>
        <p className="price" data-testid="product-price">
          {inr(product.price)}
        </p>
        <p className="muted">
          {decoy("gst_at_checkout") ? "Prices exclude GST. 18% GST is added at checkout." : "Inclusive of all taxes"}
        </p>
        <Urgency />
        <ul className="fees">
          <li>
            Delivery {inr(SHIPPING_FEE)}, free on orders above {inr(FREE_SHIPPING_MIN)}
          </li>
          {!has("drip_pricing") && (
            <li>
              + {inr(PLATFORM_FEE)} {words.feeLabel.toLowerCase()} per order
            </li>
          )}
        </ul>
        <button
          className="btn btn-primary"
          onClick={() => {
            add(product.id);
            router.push("/cart/");
          }}
        >
          Add to cart
        </button>
      </div>
    </article>
  );
}
