# Food orders home validation

The seller Food home is an owner-scoped orders inbox. Active orders and delivered/cancelled history show captured item names, selected choices, quantities, food totals, rider assignment and existing customer chat links. Menu creation remains under Menu.

An approved business has a top-right Open/Closed switch. Closing blocks new checkout and preserves existing orders. When closed, a floating home card offers a large Open button; Menu, Chat and Account remain usable. Pending and suspended businesses cannot open through the home controls.

Working hours are evaluated on the server in Uganda time. Manual changes last until the next daily opening/closing boundary. Customer browse/detail/checkout and owner profile reads reconcile overdue boundaries; the existing two-minute worker heartbeat reconciles them even without an open app. Overnight schedules are supported. With no complete schedule, control stays manual; equal opening/closing times represent all-day hours and remain manual. No database migration is needed.

Verified on 2026-10-06:

- Seven API/practice tests passed, including real database checks for ownership, environment isolation, deterministic pagination, privacy redaction, closed checkout, preserved existing orders and persisted scheduled opening/closing.
- Food and API TypeScript checks passed. Food lint passed with existing image warnings.
- Phone browser verification at 390px: active orders and quantities, History with completed/cancelled statuses, top-right switch, closed overlay, Menu access while closed, and reopening with the large Open button.
- Local-only sample API fixture was removed before release. No production accounts/orders were modified during browser verification.
