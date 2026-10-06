ALTER TABLE restaurants ADD COLUMN business_type TEXT NOT NULL DEFAULT 'restaurant'
  CHECK (business_type IN ('restaurant', 'kitchen', 'street_food', 'bakery'));
CREATE INDEX idx_restaurants_business_type ON restaurants (business_type, status, environment);
