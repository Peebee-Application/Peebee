import type { Metadata } from "next";
import StorefrontClient, { type StorefrontInitial } from "../../../components/storefront/StorefrontClient";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.peebee.online";

/** Fetch the store on the server so the page (and its title, description and link preview) is real before any script runs. */
async function loadStore(slug: string): Promise<{ initial: StorefrontInitial | null; gone: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/v1/marketplace/stores/${encodeURIComponent(slug)}`, { next: { revalidate: 60 } });
    if (res.status === 410) return { initial: null, gone: true };
    if (!res.ok) return { initial: null, gone: false };
    const body = await res.json();
    // The merchant chose not to have a web store (they are listed in the app only).
    if (body?.store?.web_store_enabled === 0 || body?.store?.web_store_enabled === false) return { initial: null, gone: true };
    // Merchant-rendered pages follow the admin's rendering option; the client path still works without it.
    if (body?.storefront?.renderMode === "client_only") return { initial: null, gone: false };
    const productsRes = await fetch(`${API_BASE}/v1/marketplace/stores/${encodeURIComponent(slug)}/products?channel=web`, { next: { revalidate: 60 } }).catch(() => null);
    const products = productsRes?.ok ? ((await productsRes.json()).products ?? []) : [];
    return {
      gone: false,
      initial: {
        store: body.store,
        products,
        collections: body.collections ?? [],
        discounts: body.discounts ?? [],
        outlets: body.outlets ?? [],
        bundles: body.bundles ?? [],
        sections: body.sections ?? [],
        digitalProducts: body.digitalProducts ?? [],
        courses: body.courses ?? [],
        storefront: body.storefront ?? null,
      },
    };
  } catch {
    return { initial: null, gone: false };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { initial } = await loadStore(slug);
  const store = initial?.store;
  if (!store) return { title: "Store", robots: { index: false } };
  const title = String(store.seo_title || store.name);
  const description = String(store.seo_description || store.description || `Shop ${store.name} online.`).slice(0, 200);
  const url = store.custom_domain ? `https://${store.custom_domain}` : `https://${store.slug}.peebee.online`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", images: store.banner_url || store.logo_url ? [String(store.banner_url || store.logo_url)] : undefined },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { initial } = await loadStore(slug);
  return <StorefrontClient overrideSlug={slug} initial={initial} />;
}
