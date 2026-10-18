"use client";

import { inr } from "../lib/catalog.ts";
import { computeOrder, type Stage } from "../lib/pricing.ts";
import { useStore } from "../lib/store.tsx";

export function OrderSummary({ stage }: { stage: Stage }) {
  const { cart, pricing } = useStore();
  const { lines, total } = computeOrder(cart, pricing, stage);
  return (
    <table className="summary" data-testid="order-summary">
      <tbody>
        {lines.map((l) => (
          <tr key={l.label} data-kind={l.kind}>
            <td>{l.label}</td>
            <td className="amount">{l.amount === 0 ? "FREE" : inr(l.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th>Total</th>
          <th className="amount" data-testid="order-total">
            {inr(total)}
          </th>
        </tr>
      </tfoot>
    </table>
  );
}
