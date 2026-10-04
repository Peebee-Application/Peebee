-- Public Peebee Merchant onboarding taxonomy.
--
-- Restaurants continue to use the dedicated Restaurant app. They may share
-- the merchant ledger internally, but must never appear as a registration
-- category in the general Merchant app.

INSERT INTO merchant_categories (id, slug, name, active, sort_order) VALUES
  ('mcat_supermarket', 'supermarket', 'Supermarket', 1, 10),
  ('mcat_retail', 'retail-shop', 'Retail Shop', 1, 20),
  ('mcat_boutique', 'boutique', 'Boutique', 1, 30),
  ('mcat_convenience', 'convenience-store-mini-mart', 'Convenience Store / Mini-Mart', 1, 40),
  ('mcat_pharmacy_health', 'pharmacy-health', 'Pharmacy & Health', 1, 50),
  ('mcat_electronics_appliances', 'electronics-appliances', 'Electronics & Appliances', 1, 60),
  ('mcat_beauty_cosmetics', 'beauty-cosmetics', 'Beauty & Cosmetics', 1, 70),
  ('mcat_bakery_confectionery', 'bakery-confectionery', 'Bakery & Confectionery', 1, 80),
  ('mcat_butchery_fresh_meat', 'butchery-fresh-meat', 'Butchery & Fresh Meat', 1, 90),
  ('mcat_liquor_wine_spirits', 'liquor-wine-spirits', 'Liquor, Wine & Spirits', 1, 100),
  ('mcat_hardware_home_improvement', 'hardware-home-improvement', 'Hardware & Home Improvement', 1, 110),
  ('mcat_stationery_bookstore', 'stationery-bookstore', 'Stationery & Bookstore', 1, 120),
  ('mcat_furniture_home_decor', 'furniture-home-decor', 'Furniture & Home Decor', 1, 130),
  ('mcat_pet_agrovet', 'pet-store-agrovet', 'Pet Store & Agrovet', 1, 140),
  ('mcat_jewelry_accessories', 'jewelry-accessories', 'Jewelry & Accessories', 1, 150),
  ('mcat_auto_parts_accessories', 'auto-parts-accessories', 'Auto Parts & Accessories', 1, 160),
  ('mcat_florist_gift', 'florist-gift-shop', 'Florist & Gift Shop', 1, 170)
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug,
  name = excluded.name,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = datetime('now');

-- Retain old categories for referential integrity and historical reporting,
-- but exclude them from all new merchant applications.
UPDATE merchant_categories
SET active = 0, updated_at = datetime('now')
WHERE id NOT IN (
  'mcat_supermarket',
  'mcat_retail',
  'mcat_boutique',
  'mcat_convenience',
  'mcat_pharmacy_health',
  'mcat_electronics_appliances',
  'mcat_beauty_cosmetics',
  'mcat_bakery_confectionery',
  'mcat_butchery_fresh_meat',
  'mcat_liquor_wine_spirits',
  'mcat_hardware_home_improvement',
  'mcat_stationery_bookstore',
  'mcat_furniture_home_decor',
  'mcat_pet_agrovet',
  'mcat_jewelry_accessories',
  'mcat_auto_parts_accessories',
  'mcat_florist_gift'
);
