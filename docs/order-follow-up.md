# Order follow-up

The customer order screen uses FOLLOW UP in the bottom navigation. The sheet lists the assigned rider, the actual food/store business, and an assigned active relay taxi operator where applicable. List orders have only their rider. Selecting a recipient changes the footer to CALL <role>; Voice call and Message target that recipient.

Rider arrival preserves the existing conditional Deliver → Arrived transition and its once-only notification. Closing delivery navigation marks arrival; the rider stays on the job’s At the customer screen. The customer sees a full-page arrival screen once per account/order/rider on that device. I’m coming sends an order message to the rider. Existing handover and settlement controls remain on the underlying order page.

Tap sends one attention signal; holding renews a short server lease for up to the admin limit, initially 20 seconds. Release, pointer cancellation, page hiding, window blur, acknowledgement, order closure, removed participants and lease expiry stop the signal. Only the original sender can renew or stop it; the recipient can acknowledge it. Private messages are scoped to one order and one participant pair.

## Operations

Apply `apps/api/src/db/migrations/0165_order_attention.sql` by hand to the live D1 database. Application deployment does not apply migrations. The new tables are additive. Until the migration is present, attention sends return a written unavailable response and incoming attention is empty; existing order endpoints keep working.

A manually dispatched `Apply reviewed database migration` workflow can apply one reviewed migration filename from clean, current main using the repository’s existing Peebee Cloudflare credential. It is never called by deployment. For this release the filename is `0165_order_attention.sql`.

Admin → Settings → Navigation exposes attention enabled, arrival enabled, hold duration, hold gesture delay, cooldown, arrival radius, polling interval and disconnect timeout. Changes are validated and activity logged.

Continuous playback reuses `/sounds/notification.mp3`. Receiving apps must be open and audio unlocked by a user gesture; vibration is subject to browser/device support. Background/closed apps receive one web push using the device’s supported notification behaviour, not a promise of continuous custom audio. Stop propagation follows the configured poll interval plus network latency, and a lost connection expires the lease.

Manual visual testing was stopped at the user’s request; see `docs/qa/order-follow-up.md` for observed results and outstanding acceptance checks.
