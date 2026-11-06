import { ActiveOrderCard } from "../components/home/ActiveOrderCard";
import { FeeProposalCard } from "../components/home/FeeProposalCard";
import { Greeting } from "../components/home/Greeting";
import { ModuleOnly } from "../components/ModuleOnly";
import { ExplorePeebeeCard, HomeLaunch } from "../components/home/HomeScreensaver";
import { LocationOnboarding } from "../components/home/LocationOnboarding";
import { OrderTypeCards } from "../components/home/OrderTypeCards";
import { RecentLists } from "../components/home/RecentLists";
import { TrustBanner } from "../components/home/TrustBanner";
import { WalletCard } from "../components/home/WalletCard";
import { HomeExperience } from "../components/home/HomeTemplates";

export default function HomePage() {
  return (
    <HomeExperience legacy={<HomeLaunch>
      <div className="space-y-6 px-4 pb-6 pt-2">
        <Greeting />
        <ExplorePeebeeCard />
        <OrderTypeCards />
        <FeeProposalCard />
        <ActiveOrderCard />
        <ModuleOnly any={["buy.shopping"]}><RecentLists /></ModuleOnly>
        <WalletCard />
        <TrustBanner />
        <LocationOnboarding />
      </div>
    </HomeLaunch>}>
      <FeeProposalCard />
      <ActiveOrderCard />
      <ModuleOnly any={["buy.shopping"]}>
        <details className="space-y-4">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">Your lists</summary>
          <RecentLists />
        </details>
      </ModuleOnly>
      <WalletCard />
      <TrustBanner />
      <LocationOnboarding />
    </HomeExperience>
  );
}
