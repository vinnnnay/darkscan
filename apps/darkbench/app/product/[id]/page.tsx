import { PRODUCTS } from "../../../lib/catalog.ts";
import { ProductView } from "./ProductView.tsx";

export const dynamicParams = false;

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ id: p.id }));
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductView id={id} />;
}
