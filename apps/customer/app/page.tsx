import { ActiveOrderCard } from "../components/home/ActiveOrderCard";
import { FeeProposalCard } from "../components/home/FeeProposalCard";
import { Greeting } from "../components/home/Greeting";
import { ModuleOnly } from "../components/ModuleOnly";
import { ExplorePeebeeCard, HomeLaunch } from "../components/home/HomeScreensaver";
import { OrderTypeCards } from "../components/home/OrderTypeCards";
import { RecentLists } from "../components/home/RecentLists";
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
      </div>
    </HomeLaunch>} urgent={<><FeeProposalCard /><ActiveOrderCard /></>}>
      <ModuleOnly any={["buy.shopping"]}>
        <RecentLists personalized />
      </ModuleOnly>
      <WalletCard personalized />
    </HomeExperience>
  );
}
