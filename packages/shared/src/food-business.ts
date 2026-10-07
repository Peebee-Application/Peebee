export const FOOD_BUSINESS_TYPES = [
  { value: 'restaurant', label: 'Restaurants', description: 'Established restaurants and dining venues' },
  { value: 'kitchen', label: 'Kitchens', description: 'Home cooks and independent kitchens' },
  { value: 'street_food', label: 'Street Food', description: 'Street stalls, Rolex, chapati and quick bites' },
  { value: 'bakery', label: 'Bakeries', description: 'Bread, cakes, pastries and baked treats' },
] as const;
export type FoodBusinessType = typeof FOOD_BUSINESS_TYPES[number]['value'];
export function foodBusinessLabel(value?: string | null) {
  return FOOD_BUSINESS_TYPES.find(type => type.value === value)?.label ?? 'Restaurants';
}
