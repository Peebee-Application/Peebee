import { api } from "./api";
import { loadOrderFeed } from "./order-feed";

export type ActivityKind = "fee" | "message" | "order" | "wallet";

export type Activity = { id: string; href: string; title: string; detail: string; kind: ActivityKind };

/** No separate notification inbox exists on the server; this gathers the
 * things that need you from live data: a rider's fee proposal, unread
 * messages and orders still in progress. */
export async function loadActivity(): Promise<Activity[]> {
  const [active, threads, restaurantThreads, feed, walletAlerts] = await Promise.allSettled([
    api.getActiveOrder(), api.getChatThreads(), api.getMyRestaurantChatThreads(), loadOrderFeed(), api.getWalletAlerts(),
  ]);
  const items: Activity[] = [];
  if (active.status === "fulfilled" && active.value.pendingFeeProposal && active.value.activeOrder) {
    items.push({ id: "fee", kind: "fee", href: `/orders/${active.value.activeOrder.id}`, title: "Your rider proposed a new fee", detail: "Review and approve or decline" });
  }
  if (threads.status === "fulfilled") {
    for (const t of threads.value.threads.filter((t) => t.unread)) {
      items.push({ id: `chat-${t.counterpartId}`, kind: "message", href: `/chat/${t.counterpartId}`, title: `New message from ${t.counterpartName}`, detail: t.lastMessagePreview });
    }
  }
  if (restaurantThreads.status === "fulfilled") {
    for (const t of restaurantThreads.value.threads.filter((t) => t.unread)) {
      items.push({ id: `rchat-${t.restaurantId}`, kind: "message", href: `/restaurants/${t.restaurantId}/chat`, title: `New message from ${t.restaurantName}`, detail: t.lastMessagePreview });
    }
  }
  if (walletAlerts.status === "fulfilled") {
    for (const alert of walletAlerts.value.alerts) {
      items.push({ id: `wallet-${alert.id}`, kind: "wallet", href: "/wallet", title: alert.title, detail: alert.body });
    }
  }
  if (feed.status === "fulfilled") {
    for (const list of feed.value.inProgress) {
      items.push({ id: `order-${list.id}`, kind: "order", href: `/orders/${list.orderId}`, title: list.title, detail: "In progress · tap to follow it" });
    }
  }
  return items;
}
