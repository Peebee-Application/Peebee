# Product variations

Shopify-style options for products, with the admin deciding which options exist and which open on Buy-home cards.

## Model
- A product has up to **3 options** (Colour, Size, Material, ...), each with values. A **variant** is one combination, with its own price, was-price, stock, SKU, barcode and photo.
- Swatch colours and per-value images live in `store_products.options_json`. Shoppers get a computed `options` list on every public product.
- Option names that mean the same thing share a key (`Colour`, `Colors`, `colour` → `color`).
- Products made before this change (variants with only a title, or up to two options in `option1/option2`) keep working. Titles-only variants show as a plain list of buttons.

## Admin: Settings → Product variations
Stored in `settings.product_variations`, saved through the normal settings update (so it appears in the activity log).
- **Agreed options**: name, how it shows (colour swatches, buttons, dropdown), suggested values, and **Open on Buy home cards**.
- **Buy home cards**: master switch, and how many options one card opens (1 or 2).
- **Limits**: options per product (1–3), variants per product (up to 200), and whether merchants may add options outside the list. Custom options never open on a Buy card.
Defaults: Colour and Size open on cards, the master switch is on, custom options are allowed.

## Merchant
Store → add product, or **Variations** on an existing product. Pick agreed options (or a custom one if allowed), add values (swatch colours for Colour), and Peebee builds every combination. Existing variants keep their id when values are unchanged, so carts and orders are not broken. The API refuses sets that break the admin's limits and removes a product it had just created if its variations are rejected.

## Shopper
- **Buy card**: the "+" opens the card in place with the agreed options, a price that follows the choice, and one Add button. Products with none of the card options (or no variants) keep the plain one-tap add.
- **Product page**: every option, with sold-out combinations struck through.
- **Cart**: tapping a row's variant label opens the same picker; the line switches variant (and merges if that variant is already in the bag).

## Migration
`apps/api/src/db/migrations/0160_product_options.sql` (apply by hand, listed in `MIGRATIONS_TO_APPLY.md`). Until it is applied, the API stores up to two options in the existing columns, a third option is refused with a clear message, and swatch colours come from named colours only.
