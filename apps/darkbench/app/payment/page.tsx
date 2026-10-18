import Link from "next/link";

export default function PaymentPage() {
  return (
    <section className="narrow" data-testid="flow-end">
      <h1>End of the DarkBench flow</h1>
      <p>Payment isn't implemented. Audits stop here, the same way they stop before payment on real sites.</p>
      <Link href="/">Back to the store</Link>
    </section>
  );
}
