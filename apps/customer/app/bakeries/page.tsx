import { FoodMarketplace } from "../../components/FoodMarketplace";

export const metadata = { title: "Bakeries | Peebee" };

export default function BakeriesPage() {
  return <FoodMarketplace mode="directory" category="bakery" />;
}
