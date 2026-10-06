ALTER TABLE restaurants ADD COLUMN theme_scene TEXT CHECK (theme_scene IS NULL OR theme_scene IN ('cove','forest','viola','violet-dusk','luigi','sunset','blush','sicily','ocean-blue','marple'));
ALTER TABLE restaurants ADD COLUMN theme_mode TEXT CHECK (theme_mode IS NULL OR theme_mode IN ('auto','light','dark'));
ALTER TABLE menu_items ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0 CHECK(is_featured IN (0,1));
ALTER TABLE list_items ADD COLUMN source_menu_item_id TEXT;
CREATE INDEX idx_food_source_item ON list_items(source_menu_item_id,list_id);
CREATE TABLE food_item_reviews (
 id TEXT PRIMARY KEY,
 menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
 order_id TEXT NOT NULL REFERENCES orders(id),
 customer_id TEXT NOT NULL REFERENCES users(id),
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT,
 recommended INTEGER NOT NULL DEFAULT 0 CHECK(recommended IN (0,1)),
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 updated_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(menu_item_id,customer_id)
);
CREATE INDEX idx_food_reviews_item ON food_item_reviews(menu_item_id,created_at);
