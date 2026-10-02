import { ActiveOrderCard } from "../components/home/ActiveOrderCard";
import { FeeProposalCard } from "../components/home/FeeProposalCard";
import { Greeting } from "../components/home/Greeting";
import { LocationOnboarding } from "../components/home/LocationOnboarding";
import { OrderTypeCards } from "../components/home/OrderTypeCards";
import { RecentLists } from "../components/home/RecentLists";
import { TrustBanner } from "../components/home/TrustBanner";
import { WalletCard } from "../components/home/WalletCard";

export default function HomePage() {
  return (
    <div className="space-y-6 px-4 pb-6 pt-2">
      <Greeting />
      <OrderTypeCards />
      <FeeProposalCard />
      <ActiveOrderCard />
      <RecentLists />
      <WalletCard />
      <TrustBanner />
      <LocationOnboarding />
    </div>
  );
}
