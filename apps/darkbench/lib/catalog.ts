export type Product = {
  id: string;
  name: string;
  price: number;
  icon: string;
  blurb: string;
  /** Paid placement. Labelled "Sponsored" unless disguised_ads is on. */
  sponsored?: boolean;
  /** Advertised in the home banner. Unavailable when bait_and_switch is on. */
  bait?: boolean;
};

export type Addon = { id: string; name: string; price: number };

export const PRODUCTS: Product[] = [
  { id: "earbuds-pro", name: "Earbuds Pro", price: 1299, icon: "🎧", blurb: "ANC, 30h battery, USB-C." },
  { id: "smart-watch", name: "Smart Watch S2", price: 2499, icon: "⌚", blurb: "AMOLED, SpO2, 7-day battery." },
  { id: "power-bank", name: "Power Bank 10000mAh", price: 999, icon: "🔋", blurb: "22.5W fast charge, two ports." },
  { id: "speaker", name: "Bluetooth Speaker", price: 1799, icon: "🔊", blurb: "IPX7, 12h playback." },
  { id: "usb-cable", name: "USB-C Cable 1m", price: 299, icon: "🔌", blurb: "60W braided cable." },
  { id: "laptop-stand", name: "Laptop Stand", price: 899, icon: "💻", blurb: "Aluminium, six heights." },
  { id: "earbuds-lite", name: "Earbuds Lite", price: 499, icon: "🎵", blurb: "Lightweight, 20h battery.", bait: true },
  { id: "phone-case", name: "Shockproof Phone Case", price: 399, icon: "📱", blurb: "Military-grade drop test.", sponsored: true },
];

/** Items that only enter the cart through add-ons, never from the product grid. */
export const ADDONS: Record<string, Addon> = {
  "protection-plan": { id: "protection-plan", name: "1-Year Protection Plan", price: 199 },
  "purchase-protection": { id: "purchase-protection", name: "Purchase Protection", price: 99 },
  "free-sample": { id: "free-sample", name: "Free sample: Cable organiser", price: 0 },
};

export function findItem(id: string): { name: string; price: number } | undefined {
  return PRODUCTS.find((p) => p.id === id) ?? ADDONS[id];
}

export const inr = (rupees: number) => "₹" + rupees.toLocaleString("en-IN");
