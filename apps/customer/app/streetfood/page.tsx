import { FoodMarketplace } from "../../components/FoodMarketplace";

export const metadata = { title: "Street Food | Peebee" };

export default function StreetfoodPage() {
  return <FoodMarketplace mode="directory" category="street_food" />;
}
