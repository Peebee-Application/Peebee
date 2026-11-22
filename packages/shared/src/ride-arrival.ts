import type { OrderDetail, Payment } from "./domain.js";

export const CASH_PAID_NOTE = "Customer reports cash paid";
export const cashPaidEventId = (orderId: string) => `cash-paid:${orderId}`;
export const paymentMethodEventId = (paymentId: string) => `payment-method:${paymentId}`;
export type RidePaymentMethod = "Cash" | "Mobile money" | "Card" | "Peebee wallet" | "Digital payment";

/** Only successful customer collections count. A rider payout, pending charge or refund never proves payment. */
export function rideArrivalPayment(detail: Pick<OrderDetail, "order" | "events" | "payments">) {
  const { order, events, payments } = detail;
  const fare = order.final_total ?? order.delivery_fee ?? order.estimated_total ?? null;
  const cash = order.payment_rail === "float";
  const sameOrder = payments.filter(p => p.order_id === order.id && p.currency === order.currency);
  const collections = sameOrder.filter(p => p.type === "collection" && p.status === "successful");
  const refunded = sameOrder.filter(p => p.type === "refund" && p.status === "successful").reduce((n, p) => n + p.amount, 0);
  const collected = Math.max(0, collections.reduce((n, p) => n + p.amount, 0) - refunded);
  const noCharge = fare === 0;
  const digitalPaid = !cash && fare != null && (noCharge || collected >= fare);
  const cashReported = events.some(e => e.id === cashPaidEventId(order.id) && e.actor_id === order.customer_id);
  const cashSettled = cash && order.stage === "Settle";
  const methodFor = (p: Payment): RidePaymentMethod => {
    const saved = events.find(e => e.id === paymentMethodEventId(p.id))?.note;
    if (saved === "card") return "Card";
    if (saved === "mobile_money") return "Mobile money";
    if (p.provider === "wallet" || p.provider === "shared_wallet") return "Peebee wallet";
    if (p.msisdn || p.network || /^(mtn|airtel|momo)(_|$)/i.test(p.provider)) return "Mobile money";
    return "Digital payment";
  };
  const methods = [...new Set(collections.map(methodFor))];
  return { fare, cash, cashReported, cashSettled, digitalPaid, noCharge, collected,
    method: cash ? "Cash" : methods.join(" + ") || "Digital payment",
    receiptAvailable: noCharge || cashSettled || digitalPaid,
  };
}
