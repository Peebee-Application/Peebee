import { StandaloneShoplist } from "../../components/StandaloneBooking";

export const metadata = { title: "Shopping list | Peebee" };

export default function ShoplistPage() {
  return (
    <div className="mx-auto max-w-lg px-5 pt-4">
      <h1 className="text-[30px] font-extrabold tracking-tight text-ink">Your list</h1>
      <p className="mt-1 text-sm font-semibold text-ink-500">Type or speak what you need. A shopper confirms the prices before you pay.</p>
      <StandaloneShoplist />
    </div>
  );
}
