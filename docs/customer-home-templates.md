# Customer home templates

Admin → Content → Home templates controls the customer home artwork. The existing app header and bottom navigation are not modified.

The ten approved layouts are 04 Day Ticket, 07 Open Book, 08 City Line, 09 Cut-Paper Poster, 11 Pinboard, 12 Folded Index, 16 Daily Diary, 17 Errands Clipboard, 18 Desk Sorter and 20 Address Book. Each uses live links and CSS paper shapes, rather than text baked into images. A single sans-serif font applies across the designs. The personalised “Hello, [first name]” and location sit above the artwork and do not rotate.

## Admin controls

- Master switch: off restores the previous home and automatic launch slideshow. While dynamic home is on, the existing slideshow remains accessible through Explore Peebee.
- Template pool: one or more of the ten designs. With multiple templates, the next design differs from the current one.
- Eligible shortcuts: 30 existing customer destinations across Ride, Deliver, Buy, Food, Work/Hire, Learn and Spotlight. Provider/back-office feature switches without a standalone customer destination are not launch shortcuts.
- Most-used shortcuts and weight: Admin chooses the frequently promoted entries; there is no claim of automatic usage analytics. Weighted sampling without replacement increases their frequency while keeping other eligible entries discoverable.
- Shortcuts per design: 1–6, limited to the number of available eligible destinations.
- Minimum/maximum switch interval: a fresh random whole-second interval is drawn between them. Equal values produce a fixed interval.
- Quiet time after interaction: postpones changes while the customer is actively using the page.

Initial defaults enable all ten templates, four shortcuts and a 90–180 second interval. No most-used entries are preselected. All operating values are editable in Admin. Existing Live/Practice switches, approved vehicle availability, Taxipress, Hire worker-search settings and home-menu shortcut visibility continue to gate destinations.

## Continuity and accessibility

Pause changes is available to every customer and is retained for that session. The chosen design and its shortcuts survive navigation in per-user session storage; storage failures do not prevent use. Disabled or removed entries cannot be restored. Orders, fee proposals, location onboarding, saved lists and wallet remain outside the rotating component; lists and wallet are accessible in the expandable section.

Automatic changes wait while the tab/window is inactive, focus is within the main content, a pointer is held, a mouse hovers over the artwork, the header menu/chat/service sheet/dialog is open, a call is active, or the quiet period has not elapsed. Returning to a visible tab starts a fresh interval. No automatic change submits an order or payment. Reduced-motion preferences suppress the entry fade. Text wraps naturally and layouts can grow for large text rather than clipping it.

Settings are reloaded on page entry, returning to the visible tab, reconnecting, and the existing data-updated event. A settings-load failure retains loaded settings or provides the existing home with retry if nothing has loaded.

## Storage and rollout

`home_templates_config` is JSON in the existing settings table. `PUT /v1/admin/settings` validates the complete object and requires `settings.manage`; customer settings responses include the resolved configuration. The standard activity log stores before/after values and its undo handler restores this setting. Missing or malformed stored JSON uses safe complete defaults.

**No migration is required.** Deploy API/Admin before Customer so the controls are available first. Deployment must follow COLLABORATION.md and scripts/preflight-deploy.mjs. This PR does not change or deploy production settings.

## Validation

Selection tests cover every design, no immediate template repeats, interval boundaries, weighted frequency, no duplicate shortcuts, service/capability filtering, session restoration and interaction safety. API integration tests use an isolated in-memory database to verify permissions, validation, persistence, customer reads, activity logging, undo and malformed-data recovery. Customer/Admin production builds, API compilation and changed-file lint/type checks were run. Local browser verification used a seeded customer fixture and confirmed the greeting, live shortcut links, unchanged shell and matching greeting/artwork font families. Representative user testing and production deployment are not part of these checks.
