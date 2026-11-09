-- Shopify-style product options: up to three named options per product (Colour, Size, ...), swatch colours and images
-- for their values, and per-variant barcode and order. Applied by hand. Until it is, merchants can still build products
-- with up to two options (the existing option1/option2 columns); the API checks each column before using it.
ALTER TABLE store_products ADD COLUMN options_json TEXT;
ALTER TABLE store_product_variants ADD COLUMN option3_name TEXT;
ALTER TABLE store_product_variants ADD COLUMN option3_value TEXT;
ALTER TABLE store_product_variants ADD COLUMN barcode TEXT;
ALTER TABLE store_product_variants ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
