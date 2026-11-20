# Customer bottom navigation

Implemented from the supplied single-page `bottom nav-design copy.pdf`, with the user's subsequent destination corrections.

## Navigation map

| Context | Left control | Gold menu |
| --- | --- | --- |
| Home | Stream, opens existing `/spotlight` feed | Ride, Buy, Eat, Learn, Work, Spaces |
| Stream | Home | Explore, Following, Creators, Market, Learn, Other |
| Ride | Back to Home | Boda, Car, Taxi, Share, Drive; existing additional transport/delivery services remain available |
| Buy | Back to Home | List, Groceries, Stores, Pharma, Orders |
| Eat | Back to Home | Restaurants, Kitchens, Street, Bakeries, Juices |
| Learn | Back to Home | Discover, Classroom, Studies, Review, Connect |
| Work | Back to Home | Clean, Laundry, Fix, Work, Talent (Admin-controlled names, ordering and availability) |
| Spaces | Back to Home | Stay, Homes, Offices, Storage, For Sale |

Street is a renamed navigation label for the existing Streetfood service, not a café category. Buy keeps Orders; the reference's Work entry was an error. Classroom, Studies and Review have explicit Coming soon pages. Existing Learn course, My Class, live, TV, study, certificate and connection pages are preserved. Discover and Connect retain their existing destinations; further learning workflows are deferred. All Spaces categories are UI-only Coming soon pages.

## Layout and actions

- One solid black shell and inset gold menu, using the existing palette and real Lucide icons. The circles in the reference are explanatory placeholders, not new icon assets.
- Four right-hand items below 420 CSS pixels (five total including the anchor), five on larger phones, and all six main items from 768 pixels. Menus with fewer entries fill the available width. Additional entries scroll horizontally.
- The selected item grows vertically and uses the existing brighter gold token. Selection scrolls toward the left on narrow phones, toward the middle on larger displays, clamped at menu boundaries. Reduced motion disables transitions and smooth scrolling.
- Existing page-provided primary actions replace the gold menu. Products and individual food items use the same shell for Add to cart, preserving cart configuration and checkout ownership.
- Explicit final payment actions (order funding, rental payment, work/laundry payment) use a confirmation gesture. Wallet sends and gift reviews use the same confirmation surface in their own content/modal footer. Existing payment handlers, validation, idempotency and provider steps remain in their original owners.
- A tap or an incomplete slide never confirms. A gesture must start on the handle. Pointer cancellation resets the gesture, and keyboard/assistive activation is supported. Submission is locked while running, errors reset the control, and the navigation never announces payment success on its own.

## Admin and compatibility

Admin > Settings > Home menu controls Stream/Explore/Spaces labels, Spaces visibility and confirmation distance (60–95%, default 85%). Values use the existing settings JSON, validation, authorization and activity log. Old settings without `navigation` resolve safe defaults; no SQL migration is required. Existing saved custom service names and module switches remain authoritative. Work/Talent are the new built-in shortcut labels.

## Verification

Local browser checks cover Home/Stream switching, hidden Stream filters, selected Spaces and Learn destinations, Back to Home, and narrow-phone/tablet widths without document overflow. An isolated, non-production interaction harness verifies accidental taps, short/full slides, keyboard confirmation, failure/retry and cancellation without moving money. The harness and local API fixture are excluded from the feature commit. Automated checks cover settings compatibility/authorization/logging, scroll bounds, cart and product pricing; CI runs the navigation tests with the existing Customer checks.
