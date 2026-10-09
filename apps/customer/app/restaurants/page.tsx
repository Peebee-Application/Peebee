import { FoodMarketplace } from "../../components/FoodMarketplace";

export const metadata = { title: "Restaurants | Peebee" };

export default function RestaurantsPage() {
  return <FoodMarketplace mode="directory" category="restaurant" />;
}
