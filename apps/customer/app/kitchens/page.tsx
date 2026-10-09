import { FoodMarketplace } from "../../components/FoodMarketplace";

export const metadata = { title: "Kitchens | Peebee" };

export default function KitchensPage() {
  return <FoodMarketplace mode="directory" category="kitchen" />;
}
