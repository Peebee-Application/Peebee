import { lazy, Suspense, useSyncExternalStore, type AnchorHTMLAttributes, type ComponentType } from "react";
import { host, subscribe } from "./host";

const customerOrigin = "https://app.peebee.online";
const localRoutes: Record<string, string> = { "/": "home", "/help": "support", "/wallet": "wallet" };

function route(href: string) {
  if (!href.startsWith("/")) return { href };
  const url = new URL(href, customerOrigin);
  if (url.origin !== customerOrigin) return { href: customerOrigin };
  const screen = localRoutes[url.pathname];
  const tab = url.searchParams.get("tab");
  const action = tab === "topup" ? "wallet-topup" : tab === "transactions" ? "wallet-transactions" : undefined;
  return screen
    ? { href: screen === "home" ? "/" : `/?screen=${screen}`, screen, action }
    : { href: url.href };
}

export function navigate(href: string) {
  const next = route(href);
  if (next.screen) host.openLocal(next.screen, next.action);
  else window.location.assign(next.href);
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => {
    const screen = document.body.dataset.activeScreen;
    return !screen || screen === "home" ? "/" : `/taxibee/${screen}`;
  });
}

const router = { push: navigate, replace: navigate, back: () => history.back(), prefetch: async () => {} };
export function useRouter() { return router; }
export function useSearchParams() { return new URLSearchParams(location.search); }

export function Link({ href = "/", onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const next = route(href);
  // The Customer chat drawer recognizes these relative links itself.
  const chat = /^\/(chat(?:\/|$)|restaurants\/[^/]+\/chat(?:\/|\?|$)|learn\/messages\/[^/]+)/.test(href);
  return <a {...props} href={chat ? href : next.href} onClick={event => {
    onClick?.(event);
    if (!next.screen || event.defaultPrevented || props.target || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    host.openLocal(next.screen, next.action);
  }} />;
}

export function dynamic<T extends object>(load: () => Promise<ComponentType<T> | { default: ComponentType<T> }>) {
  const Component = lazy(async () => {
    const result = await load();
    return typeof result === "object" && "default" in result ? result : { default: result };
  });
  return (props: T) => <Suspense fallback={null}><Component {...props} /></Suspense>;
}
