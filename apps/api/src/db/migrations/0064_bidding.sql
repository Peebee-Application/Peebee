-- Price bidding on rides/parcels (boda and car). Admin-controlled (Settings →
-- Rider matching). A rider/driver who applies to a job may name their own
-- price; the customer sees every bid next to the app's own price and picks.
--
--   order_applications.bid_amount  the applicant's total price for the job
--                                  (NULL = they accept the app's price)
--   orders.app_price               the price the app calculated, kept once a
--                                  bid has replaced estimated_total so bid
--                                  limits stay measured against the original
ALTER TABLE order_applications ADD COLUMN bid_amount INTEGER;
ALTER TABLE orders ADD COLUMN app_price INTEGER;
