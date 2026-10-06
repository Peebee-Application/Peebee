/** Seller-facing food queue. Keep customer PINs, payment secrets and GPS out. */
export type FoodSellerOrder = {
  id: string;
  stage: string;
  customerId: string;
  customerName: string;
  riderName: string | null;
  createdAt: string;
  updatedAt: string;
  items: { name: string; quantity: number; unitPrice: number | null }[];
  itemsTotal: number | null;
};
export type FoodSellerOrders = {
  orders: FoodSellerOrder[];
  counts: { active: number; history: number };
  nextCursor: string | null;
};
export const FOOD_ORDER_HISTORY_STAGES = [
  "Handover",
  "Settle",
  "Cancelled",
] as const;
export function foodOrderStatus(stage: string): string {
  const labels: Record<string, string> = {
    Create: "Awaiting a rider",
    Match: "Awaiting payment confirmation",
    Shop: "Confirmed · for pickup",
    Substitute: "Item change requested",
    Approve: "Changes approved · for pickup",
    Deliver: "Out for delivery",
    Arrived: "At the customer's location",
    Handover: "Delivered · settlement pending",
    Settle: "Completed",
    Cancelled: "Cancelled",
  };
  return labels[stage] ?? "In progress";
}
