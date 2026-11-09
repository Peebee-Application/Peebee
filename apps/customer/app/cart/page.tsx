"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, MapPin, Minus, Plus, ShoppingBag, Trash2, Truck } from "lucide-react";
import type { CheckoutDelivery, CheckoutItem } from "@peebee/shared";
import { useCart, cartOwnerId, dismissEarlierCartNotice } from "../../lib/cart";
import { EarlierCarts } from "../../components/EarlierCarts";
import { ProductImage } from "../../components/ProductImage";
import { RoundCheck } from "../../components/marketplace/MarketplaceUI";
import { SwipeRow } from "../../components/buy/motion";
import { api, errorMessage } from "../../lib/api";
import { useBagQuote, type BagDeliveryMode, type BagQuote } from "../../lib/bag-quote";
import { bagDestinationFields, useBagDeliveryPlace } from "../../lib/bag-place";
import { bagRelayLastMileInput, bagRelayShownLegs } from "../../components/BagRelayDetails";
import { BagDeliveryBreakdown, BagDestinationCard } from "../../components/BagDeliveryBreakdown";
import { OrderBreakdown } from "../../components/OrderBreakdown";
import { PlaceFlow } from "../../components/PlaceFlow";
import { SavedCartsList, useCartRows } from "../../components/SavedCarts";
import { pickMeetStageId, type LastMileChoiceValue } from "../../components/LastMileChoice";
import { useRegisterNavPrimaryAction, useRegisterNavBack, goBackOr } from "../../lib/nav-primary-action";
import {
  BAG_CHECKOUT_STEPS,
  BAG_CHECKOUT_STEP_LABEL,
  bagCheckoutHref,
  clearBagDeliveryChoice,
  parseBagCheckoutStep,
  previousBagCheckoutStep,
  readBagDeliveryChoice,
  saveBagDeliveryChoice,
  type BagCheckoutStep,
} from "../../lib/bag-checkout";

let pendingNoticeDismiss: ReturnType<typeof setTimeout> | undefined;

const ugx = (n: number) => `UGX ${n.toLocaleString()}`;

/** The Review step's delivery, from the server's quote for the choices made on the Delivery step. */
function reviewDelivery(quote: BagQuote, lastMile: LastMileChoiceValue, meetStageId: string | null): CheckoutDelivery {
  const pickups = quote.stores.map((store) => store.storeName);
  const relay = quote.deliveryMode === "relay" ? quote.relay : null;
  if (!relay) return { total: quote.deliveryFee, mode: "rider", pickups, marketplace: true };
  const shown = bagRelayShownLegs(relay, lastMile);
  const meetName = shown.meeting
    ? relay.meetStages?.find((stage) => stage.id === pickMeetStageId(relay.meetStages, meetStageId))?.name ?? null
    : null;
  return {
    total: quote.deliveryFee,
    mode: "relay",
    pickups,
    marketplace: true,
    lastMile: shown.toDoor ? "door" : "collect",
    station: meetName ?? shown.station,
    legs: shown.legs.map((leg) => ({
      leg: leg.leg,
      kind: leg.kind,
      fromName: leg.fromName,
      toName: leg.toName,
      distanceKm: leg.distanceKm ?? null,
      fee: leg.fee,
      ...(leg.kind === "matatu" ? { direction: relay.direction ?? null } : {}),
    })),
  };
}

/** "Step 2 of 3 · Delivery", with a bar per step. */
function StepProgress({ step }: { step: BagCheckoutStep }) {
  const index = BAG_CHECKOUT_STEPS.indexOf(step);
  return (
    <div className="space-y-1.5" aria-label={`Step ${index + 1} of ${BAG_CHECKOUT_STEPS.length}: ${BAG_CHECKOUT_STEP_LABEL[step]}`}>
      <div className="flex gap-1.5" aria-hidden>
        {BAG_CHECKOUT_STEPS.map((s, i) => (
          <span key={s} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-gold" : "bg-[rgb(var(--surface-muted))]"}`} />
        ))}
      </div>
      <p className="text-[11px] font-semibold text-ink-500">
        Step {index + 1} of {BAG_CHECKOUT_STEPS.length} · {BAG_CHECKOUT_STEP_LABEL[step]}
      </p>
    </div>
  );
}

export default function CartPage() {
  return (
    <Suspense fallback={<CartSpinner />}>
      <CartCheckout />
    </Suspense>
  );
}

function CartSpinner() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <div className="h-9 w-9 animate-spin rounded-full border-3 border-gold border-t-transparent" />
    </div>
  );
}

/**
 * The shopping bag's checkout, one step per screen (lib/bag-checkout.ts): Bag → Delivery → Review
 * and pay. Only this bag's selected lines are ever ordered; restaurant carts and earlier carts are
 * listed (to open on their own screens) but never touched.
 */
function CartCheckout() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedStep = parseBagCheckoutStep(searchParams.get("step"));
  const {
    items,
    mounted,
    selectedItems,
    selectedCount,
    subtotal,
    updateQuantity,
    removeItem,
    toggleItemSelection,
    selectAll,
    clearCart,
    completeCheckout,
  } = useCart();
  // The "saved under Earlier carts" notice is shown once: leaving this screen clears it
  // (deferred, so a dev-mode remount does not clear it while it is still on screen).
  useEffect(() => {
    clearTimeout(pendingNoticeDismiss);
    return () => {
      pendingNoticeDismiss = setTimeout(dismissEarlierCartNotice, 0);
    };
  }, []);

  // Delivery and Review need something to deliver: with nothing selected the bag step shows.
  const step: BagCheckoutStep = selectedCount === 0 ? "bag" : requestedStep;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // Where the bag goes: chosen on the map and remembered on this device. Never a default place.
  const delivery = useBagDeliveryPlace();
  const [choosingPlace, setChoosingPlace] = useState(false);
  // The delivery fee is the server's, for this place and the chosen way. Checkout waits for it.
  const [deliveryMode, setDeliveryMode] = useState<BagDeliveryMode | undefined>(undefined);
  const [relayLastMile, setRelayLastMile] = useState<LastMileChoiceValue>("door");
  const [relayMeetStageId, setRelayMeetStageId] = useState<string | null>(null);
  // The choices made on the Delivery step stay for Review (and a reload) in this tab.
  const [choiceLoaded, setChoiceLoaded] = useState(false);
  useEffect(() => {
    const saved = readBagDeliveryChoice(cartOwnerId());
    setDeliveryMode(saved.deliveryMode);
    setRelayLastMile(saved.relayLastMile);
    setRelayMeetStageId(saved.relayMeetStageId);
    setChoiceLoaded(true);
  }, []);
  useEffect(() => {
    if (choiceLoaded) saveBagDeliveryChoice(cartOwnerId(), { deliveryMode, relayLastMile, relayMeetStageId });
  }, [choiceLoaded, deliveryMode, relayLastMile, relayMeetStageId]);

  const destination =
    delivery.place?.lat != null && delivery.place.lng != null ? { lat: delivery.place.lat, lng: delivery.place.lng } : null;
  const bagQuote = useBagQuote(selectedItems, {
    enabled: mounted && delivery.ready && choiceLoaded && step !== "bag",
    destination,
    deliveryMode,
    relayLastMile,
    relayMeetStageId: relayMeetStageId ?? undefined,
  });
  const total = bagQuote.quote?.total ?? null;
  const storeCount = new Set(selectedItems.map((it) => it.storeId)).size;

  // Steps are history entries: forward pushes, Back returns to the step before (never another screen's checkout).
  const pushedSteps = useRef(new Set<BagCheckoutStep>());
  const goToStep = (next: BagCheckoutStep) => {
    setCheckoutError(null);
    pushedSteps.current.add(next);
    router.push(bagCheckoutHref(next));
  };
  const stepBack = () => {
    const previous = previousBagCheckoutStep(step);
    if (!previous) {
      goBackOr(router, "/shopping");
      return;
    }
    if (pushedSteps.current.has(step)) {
      pushedSteps.current.delete(step);
      router.back();
    } else {
      router.replace(bagCheckoutHref(previous));
    }
  };

  const handleCheckout = async () => {
    const quote = bagQuote.quote;
    if (selectedItems.length === 0 || isSubmitting || total == null || !quote || !delivery.place) return;
    setIsSubmitting(true);
    setCheckoutError(null);
    // Only the current bag's selected lines are ever submitted (earlier carts and restaurant carts never are).
    const submitted = selectedItems;

    try {
      const res = await api.checkoutMarketplace({
        items: submitted.map((it) => ({
          productId: it.productId,
          storeId: it.storeId,
          title: it.title,
          price: it.price,
          quantity: it.quantity,
          variantId: it.variantId,
          variantTitle: it.variantTitle,
          imageUrl: it.imageUrl,
        })),
        paymentRail: "escrow",
        ...bagDestinationFields(delivery.place),
        // The way this quote priced, so the order is charged what was shown.
        deliveryMode: quote.deliveryMode,
        ...(quote.deliveryMode === "relay" ? bagRelayLastMileInput(quote.relay, relayLastMile, relayMeetStageId) : {}),
      });

      const firstOrder = res.order ?? res.orders?.[0];
      // Checked-out lines leave the bag; unselected ones are kept under Earlier carts.
      completeCheckout(submitted.map((it) => it.id));
      clearBagDeliveryChoice(cartOwnerId());
      setIsSubmitting(false);

      // This bag's own order: its pay page replaces the Review step (Back from there goes to the order).
      if (firstOrder?.id) {
        router.replace(`/orders/${firstOrder.id}/pay`);
      } else {
        router.replace("/orders");
      }
    } catch (err) {
      setCheckoutError(errorMessage(err));
      setIsSubmitting(false);
    }
  };

  const allSelected = items.length > 0 && items.every((i) => i.selected);
  const otherCarts = useCartRows();

  // Each step's next action lives in the bottom nav's right capsule; the nav's Home is a one-step Back.
  useRegisterNavBack(true, stepBack);
  useRegisterNavPrimaryAction(
    !mounted || items.length === 0
      ? null
      : step === "bag"
        ? {
            tone: "step",
            label: "Continue to delivery",
            detail: ugx(subtotal),
            disabled: selectedCount === 0,
            onClick: () => goToStep("delivery"),
          }
        : step === "delivery"
          ? bagQuote.needsDestination
            ? { tone: "step", label: "Choose location", onClick: () => setChoosingPlace(true) }
            : {
                tone: "step",
                label: "Continue to review",
                disabled: !bagQuote.quote,
                onClick: () => goToStep("review"),
              }
          : bagQuote.needsDestination
            ? { tone: "step", label: "Choose location", onClick: () => setChoosingPlace(true) }
            : {
                tone: "gold",
                label: isSubmitting ? "Placing order…" : total == null ? "Please wait…" : "Place order",
                detail: total == null ? undefined : ugx(total),
                disabled: isSubmitting || total == null,
                busy: isSubmitting,
                onClick: () => void handleCheckout(),
              },
  );

  if (!mounted) return <CartSpinner />;

  const quote = bagQuote.quote;
  const reviewItems: CheckoutItem[] = selectedItems.map((it) => ({
    orderId: "",
    storeName: it.storeName ?? null,
    name: it.variantTitle ? `${it.title} (${it.variantTitle})` : it.title,
    quantity: it.quantity,
    price: it.price * it.quantity,
  }));

  return (
    <div className="min-h-screen pb-6 text-ink">
      <div className="mx-auto max-w-md px-4 pt-3 space-y-5">
        <header className="space-y-3 py-2">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={stepBack}
              aria-label="Back"
              className="w-11 h-11 rounded-full bg-[rgb(var(--surface-card))] border border-[var(--border-faint)] shadow-[var(--shadow-card)] flex items-center justify-center text-ink active:scale-95 transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <h1 className="text-lg font-bold text-ink tracking-tight">{step === "bag" ? "Cart" : BAG_CHECKOUT_STEP_LABEL[step]}</h1>

            <div className="flex w-11 items-center justify-end">
              {step === "bag" && items.length > 0 && (
                <button
                  type="button"
                  onClick={clearCart}
                  aria-label="Clear Bag"
                  className="w-11 h-11 rounded-full text-ink-500 hover:text-red-500 flex items-center justify-center transition"
                  title="Clear bag"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          {items.length > 0 && <StepProgress step={step} />}
        </header>

        {step === "bag" && (
          <>
            <EarlierCarts showList={false} />

            {items.length === 0 ? (
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-10 text-center space-y-4 mt-6 shadow-[var(--shadow-card)]">
                <div className="w-20 h-20 mx-auto rounded-full bg-gold/15 text-gold flex items-center justify-center">
                  <ShoppingBag className="w-10 h-10" />
                </div>
                <h2 className="text-xl font-bold text-ink">Your cart is empty</h2>
                <p className="text-xs text-ink-500 leading-relaxed max-w-xs mx-auto">
                  Explore groceries, fashion, bakery treats, electronics & local products from Kampala&apos;s finest stores.
                </p>
                <Link
                  href="/stores"
                  className="inline-block rounded-full bg-gold px-7 py-3.5 text-xs font-black uppercase tracking-wider text-ink-gold shadow-md hover:bg-gold/90 active:scale-98 transition"
                >
                  Explore Stores
                </Link>
              </div>
            ) : (
              <>
                {/* Select All Row */}
                <div className="flex items-center justify-between px-1 text-xs font-semibold text-ink-500">
                  <button
                    type="button"
                    onClick={() => selectAll(!allSelected)}
                    className="flex items-center gap-2 hover:text-ink transition"
                  >
                    <div
                      className={`w-6 h-6 rounded-[8px] flex items-center justify-center border transition ${
                        allSelected
                          ? "bg-gold border-gold text-ink-gold"
                          : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))]"
                      }`}
                    >
                      {allSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                    <span>Select all ({items.length} items)</span>
                  </button>

                  <span>
                    {selectedCount} item{selectedCount === 1 ? "" : "s"} chosen
                  </span>
                </div>

                <ul className="space-y-3">
                  {items.map((item) => (
                    <SwipeRow key={item.id} id={`bag-${item.id}`} label={item.title} onRemove={() => removeItem(item.id)}>
                    <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3 shadow-[var(--shadow-card)] flex items-center gap-3.5">
                      <Link
                        href={`/product/${item.productId}`}
                        className="relative w-[84px] h-[84px] rounded-[18px] overflow-hidden shrink-0 bg-[rgb(var(--surface-muted))]"
                        aria-label={item.title}
                      >
                        <ProductImage
                          src={item.imageUrl}
                          alt={item.title}
                          category={item.category}
                          aspectRatio="square"
                          className="w-full h-full object-cover"
                        />
                      </Link>

                      <div className="flex-1 min-w-0 self-stretch flex flex-col justify-between py-0.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <Link
                              href={`/product/${item.productId}`}
                              className="font-semibold text-sm text-ink hover:text-gold transition-colors line-clamp-1 block"
                            >
                              {item.title}
                            </Link>
                            <p className="text-[11px] text-ink-500 line-clamp-1 mt-0.5">
                              {item.variantTitle || item.storeName}
                            </p>
                          </div>
                          <RoundCheck
                            checked={!!item.selected}
                            onToggle={() => toggleItemSelection(item.id)}
                            label={`Select ${item.title}`}
                          />
                        </div>

                        <div className="mt-2 flex items-end justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-bold text-base text-ink leading-none">
                              UGX {item.price.toLocaleString()}
                            </div>
                            {item.compareAtPrice && item.compareAtPrice > item.price && (
                              <div className="text-[10px] text-ink-500 line-through mt-0.5">
                                UGX {item.compareAtPrice.toLocaleString()}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => removeItem(item.id)}
                              className="text-[11px] font-semibold text-ink-500 hover:text-red-500 mt-1 transition"
                            >
                              Remove
                            </button>
                          </div>

                          <div className="inline-flex items-center gap-1 shrink-0 rounded-full bg-[rgb(var(--surface-muted))] p-1">
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, -1)}
                              className="h-11 w-11 rounded-full flex items-center justify-center text-ink active:scale-95"
                              aria-label={`Decrease quantity of ${item.title}`}
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <span className="text-sm font-semibold w-5 text-center" aria-live="polite">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, 1)}
                              className="h-11 w-11 rounded-full flex items-center justify-center text-ink active:scale-95"
                              aria-label={`Increase quantity of ${item.title}`}
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    </SwipeRow>
                  ))}
                </ul>

                {/* Items only: delivery is its own step. */}
                <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 space-y-1.5 shadow-[var(--shadow-card)]">
                  <div className="flex justify-between items-baseline">
                    <span className="font-bold text-sm text-ink">Subtotal ({selectedCount} item{selectedCount === 1 ? "" : "s"})</span>
                    <span className="font-bold text-lg text-ink">{ugx(subtotal)}</span>
                  </div>
                </div>

                {selectedCount === 0 && (
                  <p className="text-center text-xs text-ink-500">Select an item to continue.</p>
                )}
              </>
            )}

            <EarlierCarts showNotice={false} />
            {/* Restaurant carts are kept as they were; each is ordered from its own restaurant's page. */}
            <SavedCartsList rows={otherCarts} exclude={(row) => row.href === "/cart"} heading="Other carts" className="rounded-[20px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-2.5" />
          </>
        )}

        {step === "delivery" && (
          <>
            <section className="space-y-2" aria-label="Delivery location">
              <p className="text-xs font-bold uppercase tracking-wider text-ink-500 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-gold" aria-hidden />
                <span>Delivery location</span>
              </p>
              <BagDestinationCard
                place={delivery.place}
                ready={delivery.ready}
                onChange={() => setChoosingPlace(true)}
                disabled={isSubmitting}
              />
            </section>

            <section className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 space-y-3 shadow-[var(--shadow-card)]" aria-label="How it's delivered">
              <p className="text-xs font-bold uppercase tracking-wider text-ink-500 flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 text-gold" aria-hidden />
                <span>How it&apos;s delivered</span>
              </p>
              <div className="text-xs">
                <BagDeliveryBreakdown
                  bag={bagQuote}
                  storeCount={storeCount}
                  onModeChange={setDeliveryMode}
                  lastMile={relayLastMile}
                  onLastMileChange={setRelayLastMile}
                  meetStageId={relayMeetStageId}
                  onMeetStageChange={setRelayMeetStageId}
                  onChooseLocation={() => setChoosingPlace(true)}
                  disabled={isSubmitting}
                />
              </div>
            </section>
          </>
        )}

        {step === "review" && (
          <>
            {delivery.place && (
              <button
                type="button"
                onClick={stepBack}
                className="flex w-full items-center gap-3 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-3 text-left"
                aria-label={`Delivery to ${delivery.place.label}. Change delivery`}
              >
                <MapPin className="h-4 w-4 shrink-0 text-gold" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">Deliver to {delivery.place.label}</span>
                <span className="shrink-0 text-[11px] font-bold text-gold">Change</span>
              </button>
            )}
            <ul className="space-y-2" aria-label="Items in this order">
              {selectedItems.map((item) => (
                <li key={item.id} className="flex items-center gap-3 rounded-[22px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.title}</p>
                    <p className="text-[12px] font-semibold text-ink-500">UGX {item.price.toLocaleString()} each</p>
                  </div>
                  <div className="field-box inline-flex items-center rounded-full px-1">
                    <button type="button" className="h-11 w-11" aria-label={`Decrease quantity of ${item.title}`} onClick={() => updateQuantity(item.id, -1)}><Minus className="mx-auto h-4 w-4" /></button>
                    <span className="w-5 text-center text-sm font-semibold" aria-live="polite">{item.quantity}</span>
                    <button type="button" className="h-11 w-11" aria-label={`Increase quantity of ${item.title}`} onClick={() => updateQuantity(item.id, 1)}><Plus className="mx-auto h-4 w-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
            <section className="home-card space-y-2" aria-live="polite" aria-label="Order summary">
              {quote ? (
                <OrderBreakdown items={reviewItems} itemsSubtotal={quote.itemsTotal} delivery={reviewDelivery(quote, relayLastMile, relayMeetStageId)} total={quote.total} showDeliveryLines={false} />
              ) : bagQuote.failed ? (
                <button type="button" onClick={bagQuote.retry} className="text-sm font-bold text-gold">Could not load the delivery price. Retry</button>
              ) : (
                <p className="text-sm text-ink-500">{bagQuote.needsDestination ? "Choose a delivery location first." : "Loading your total…"}</p>
              )}
            </section>
          </>
        )}

        {checkoutError && (
          <div role="alert" className="rounded-[18px] bg-red-500/10 border border-red-500/20 p-3 text-xs font-semibold text-red-600 text-center">
            {checkoutError}
          </div>
        )}
      </div>
      {choosingPlace && (
        <PlaceFlow
          concept="shopping"
          initial={{ destination: delivery.place }}
          onClose={() => setChoosingPlace(false)}
          onDone={(r) => {
            delivery.choose(r.destination);
            setChoosingPlace(false);
          }}
        />
      )}
    </div>
  );
}
