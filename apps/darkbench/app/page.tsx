"use client";

import Link from "next/link";
import { PRODUCTS, inr, type Product } from "../lib/catalog.ts";
import { useStore } from "../lib/store.tsx";

export default function Home() {
  const { has, words } = useStore();
  const bait = PRODUCTS.find((p) => p.bait)!;
  const regular = PRODUCTS.filter((p) => !p.sponsored && !p.bait);
  const picks = [PRODUCTS.find((p) => p.sponsored)!, regular[2]!, regular[4]!];

  return (
    <>
      <Link href={`/product/${bait.id}/`} className="banner">
        Mega deal: {bait.name} at just {inr(bait.price)}!
      </Link>

      <h2>Top picks for you</h2>
      <div className="grid">
        {picks.map((p) => (
          <Card key={p.id} product={p} label={p.sponsored && !has("disguised_ads") ? words.adLabel : undefined} />
        ))}
      </div>

      <h2>All products</h2>
      <div className="grid">
        {[...regular, bait].map((p) => (
          <Card key={p.id} product={p} />
        ))}
      </div>
    </>
  );
}

function Card({ product, label }: { product: Product; label?: string }) {
  // Paid placements go through an ad-click tracker, like real marketplaces' sponsored links.
  const href = `/product/${product.id}/${product.sponsored ? "?sp_click=home_top_picks" : ""}`;
  return (
    <Link href={href} className="card">
      {label && <span className="ad-label">{label}</span>}
      <span className="icon" aria-hidden>
        {product.icon}
      </span>
      <span className="name">{product.name}</span>
      <span className="price">{inr(product.price)}</span>
    </Link>
  );
}
