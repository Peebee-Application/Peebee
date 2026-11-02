# Migrations to apply by hand

The deploy does not run migrations. Apply these to the live D1 database, in this order, before turning the matching
options on in Admin → Settings → Commerce options. The code keeps working without them (it falls back or answers
`503 migration_pending`), but the new behaviour stays unavailable until they are applied.

| File | What it enables |
| --- | --- |
| `apps/api/src/db/migrations/0137_storefront_hardening.sql` | Web storefront: custom-domain ownership, loyalty, section content, SMS log, ad-pixel settings |
| `apps/api/src/db/migrations/0138_digital_fulfillment.sql` | Digital products: hashed access tokens, licence-key pool, file links, refunds |
| `apps/api/src/db/migrations/0139_lms_hardening.sql` | LMS: enrolment rules, course listing, certificates, email log |
| `apps/api/src/db/migrations/0140_services_hardening.sql` | Services: opening hours, days off, booking codes and seats, online payments and refunds |
| `apps/api/src/db/migrations/0141_merchant_portal.sql` | Merchant sign-up website: per-store "listed in the app" and "web store" switches, and where a merchant registered |
| `apps/api/src/db/migrations/0143_merchant_plans.sql` | Merchant plans: marks every existing store as keeping its current access, and records which plan a subscription bought |
| `apps/api/src/db/migrations/0147_offers_incentives_credit.sql` | Offers (promo codes, discounts, ride packs, cashback), invitations, the rider discount wallet, rider incentives and online-time tracking, long-pickup distance, and customer wallet credit (bonus money). Admin → Offers shows "needs migration 0147" until it is applied; nothing in it takes effect before then |
| `apps/api/src/db/migrations/0148_costing.sql` | The costing mechanism: each order's fare breakdown, the payment-splits report (Admin → Money flow), top-up fee/bonus columns, and customer withdrawals. Fares, quotes and settlement all keep working without it; the report stays empty and withdrawals answer 503 until it is applied |
| `apps/api/src/db/migrations/0149_demo_accounts.sql` | Test accounts that live only in the sandbox and practice: `users.is_demo`. A marked account is left out of live matching and live lists and stays available in the sandbox and in practice. Nothing changes until an account is marked (see below); without the migration, accounts are told apart by id prefix only |
| `apps/api/src/db/migrations/0150_support_chat.sql` | Website support chat: chats and messages for the AI assistant and the hand-over to the support team (Admin → Support chat). Until it is applied the website chat keeps its built-in demo replies and the inbox shows "migration pending" |

After applying 0149, mark the hand-made test accounts (check the list first, then run it):

```sql
SELECT id, name, role FROM users WHERE name LIKE 'LIVETEST %';
UPDATE users SET is_demo = 1 WHERE name LIKE 'LIVETEST %';
```
| `apps/api/src/db/migrations/0151_support_chat_identity.sql` | Support chat: records which app a chat came from and who was signed in (4 nullable columns on `support_chats`). Needs 0150 first. Until applied, chats work as before and the inbox shows "Not signed in" |
| `apps/api/src/db/migrations/0152_ai_key_features.sql` | AI features: lets a Google AI key be reserved for one AI feature (`ai_api_keys.feature`) and allows one master key per pool. Needs 0074 first. Until applied, every feature shares one pool and Admin → AI features shows "separate" as unavailable |
| `apps/api/src/db/migrations/0153_ai_key_usage.sql` | Google AI keys: records which AI feature each key has actually served (Admin → Google AI keys shows it per key). Needs 0074 first. Until applied, keys work as before and the usage lines stay empty |
| `apps/api/src/db/migrations/0154_support_chat_alerts.sql` | Support chat alerts and availability: reminder tracking on chats (`alerted_at`, `alert_count`), when a visitor last looked (`visitor_seen_at`), an optional contact line, and a table of which staff have the admin app open. Needs 0150 and 0151. Until applied, staff get one alert per waiting chat (no reminders), visitors are not pushed replies, and nobody can be shown as online |

Each file is safe to read before running: they only add tables, columns and indexes. Run them one at a time and check
the Admin → Commerce options page — an option whose migration is missing is shown as unavailable and cannot be chosen.

Known shared numbers (`0012`, `0013`, `0042`, `0043`, `0090`, `0107`, `0132`) pre-date this list and are already
applied; do not rename them. `src/db/migrations.test.ts` stops any new number being reused.
