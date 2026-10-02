import { ActiveOrderCard } from "../components/home/ActiveOrderCard";
import { FeeProposalCard } from "../components/home/FeeProposalCard";
import { Greeting } from "../components/home/Greeting";
import { HomeMapHero } from "../components/home/HomeMapHero";
import { LocationOnboarding } from "../components/home/LocationOnboarding";
import { OrderTypeCards } from "../components/home/OrderTypeCards";
import { RecentLists } from "../components/home/RecentLists";
import { TrustBanner } from "../components/home/TrustBanner";
import { WalletCard } from "../components/home/WalletCard";

export default function HomePage() {
  return (
    <div>
      <HomeMapHero />
      <div className="soft-drawer relative z-10 -mt-7 space-y-6 px-4 pb-6 pt-3">
        <span className="mx-auto block h-1.5 w-10 rounded-full bg-[rgb(var(--color-ink-500)/0.25)]" aria-hidden />
        <Greeting />
        <OrderTypeCards />
        <FeeProposalCard />
        <ActiveOrderCard />
        <RecentLists />
        <WalletCard />
        <TrustBanner />
        <LocationOnboarding />
      </div>
    </div>
  );
}
