/**
 * The shops the survey and the sweep work through: well-known Indian e-commerce sites.
 *
 * `probes` are the cart/checkout URLs tested against robots.txt. They are *candidates*, not
 * necessarily each shop's real cart URL, so the survey also reports every cart-like Disallow
 * rule it finds. Checkout often lives on another host, which is why probes are full URLs.
 */
export type Probe = { label: string; url: string };
export type Shop = { id: string; name: string; home: string; probes: Probe[] };

const cart = (url: string): Probe => ({ label: "cart", url });
const checkout = (url: string): Probe => ({ label: "checkout", url });

export const SHOPS: Shop[] = [
  {
    id: "amazon-in",
    name: "Amazon.in",
    home: "https://www.amazon.in/",
    probes: [cart("https://www.amazon.in/gp/cart/view.html"), checkout("https://www.amazon.in/gp/buy/spc/handlers/display.html")],
  },
  {
    id: "flipkart",
    name: "Flipkart",
    home: "https://www.flipkart.com/",
    probes: [cart("https://www.flipkart.com/viewcart"), checkout("https://www.flipkart.com/checkout/init")],
  },
  {
    id: "myntra",
    name: "Myntra",
    home: "https://www.myntra.com/",
    probes: [cart("https://www.myntra.com/checkout/cart"), checkout("https://www.myntra.com/checkout/address")],
  },
  {
    id: "snapdeal",
    name: "Snapdeal",
    home: "https://www.snapdeal.com/",
    probes: [cart("https://www.snapdeal.com/cart"), checkout("https://www.snapdeal.com/checkout")],
  },
  {
    id: "nykaa",
    name: "Nykaa",
    home: "https://www.nykaa.com/",
    probes: [cart("https://www.nykaa.com/cart"), checkout("https://www.nykaa.com/checkout")],
  },
  {
    id: "tatacliq",
    name: "Tata CLiQ",
    home: "https://www.tatacliq.com/",
    probes: [cart("https://www.tatacliq.com/mybag"), checkout("https://www.tatacliq.com/checkout")],
  },
  {
    id: "firstcry",
    name: "FirstCry",
    home: "https://www.firstcry.com/",
    // Its cart and payment live on another host, which a www-only survey misses.
    probes: [cart("https://www.firstcry.com/cart"), cart("https://checkout.firstcry.com/cart"), checkout("https://checkout.firstcry.com/pay")],
  },
  {
    id: "croma",
    name: "Croma",
    home: "https://www.croma.com/",
    probes: [cart("https://www.croma.com/cart"), checkout("https://www.croma.com/checkout")],
  },
  {
    id: "ajio",
    name: "AJIO",
    home: "https://www.ajio.com/",
    probes: [cart("https://www.ajio.com/bag"), checkout("https://www.ajio.com/checkout")],
  },
  {
    id: "reliance-digital",
    name: "Reliance Digital",
    home: "https://www.reliancedigital.in/",
    probes: [cart("https://www.reliancedigital.in/cart"), checkout("https://www.reliancedigital.in/checkout")],
  },
  {
    id: "boat",
    name: "boAt",
    home: "https://www.boat-lifestyle.com/",
    probes: [cart("https://www.boat-lifestyle.com/cart"), checkout("https://www.boat-lifestyle.com/checkouts")],
  },
  {
    id: "bewakoof",
    name: "Bewakoof",
    home: "https://www.bewakoof.com/",
    probes: [cart("https://www.bewakoof.com/cart"), checkout("https://www.bewakoof.com/checkout")],
  },
  {
    id: "lenskart",
    name: "Lenskart",
    home: "https://www.lenskart.com/",
    probes: [cart("https://www.lenskart.com/cart"), checkout("https://www.lenskart.com/checkout")],
  },
  {
    id: "decathlon",
    name: "Decathlon",
    home: "https://www.decathlon.in/",
    probes: [cart("https://www.decathlon.in/cart"), checkout("https://www.decathlon.in/checkout")],
  },
  {
    id: "pepperfry",
    name: "Pepperfry",
    home: "https://www.pepperfry.com/",
    probes: [cart("https://www.pepperfry.com/cart"), checkout("https://www.pepperfry.com/checkout")],
  },
];

export const shopById = (id: string): Shop | undefined => SHOPS.find((s) => s.id === id);
