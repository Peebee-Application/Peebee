# Customer standard palette and profile header

Verified at a 390 x 844 mobile viewport using isolated fictional preview data on 2026-10-07. Temporary API fixtures were removed before commit. No production user details were edited.

- [Dark home](customer-standard-dark.png): black header and floating dock, white logo/wordmark, charcoal page, expanded profile card and location beneath the welcome heading.
- [Light home](customer-standard-light.png): charcoal header, white page, black/charcoal dock, white logo and profile card.
- [Restaurant menu](customer-restaurant-scoped-menu.png): owner Forest/dark content inside the light customer app. Header remains rgb(26,26,26); dock remains black/charcoal; root mode remains light; business mode is dark and background rgb(20,25,13). Location badge is absent.
- [Reverse boundary](customer-dark-restaurant-light.png): customer dark mode with owner Forest/light content. Header and dock stay rgb(0,0,0), business text rgb(10,10,10).

Expanding the header moved the main content top from approximately 69px to 188px; the profile card occupies document flow instead of covering the welcome. The card opens Account. Saving the fictional display name updated the account and the welcome heading. Account contains Auto/Light/Dark, profile-photo management, saved addresses/locations and the existing password flow; there is no colour-theme picker. Colour-scene preferences saved by older customer releases are no longer applied.

Restaurant theme attributes now belong to a stable content wrapper, not document.documentElement. Only the storefront and dish pages use that wrapper; restaurant chat, account, global overlays, header and navigation retain the standard customer palette. The owner's Food app and theme choices are unchanged.

Profile pictures are authenticated blobs with URL cleanup and an icon fallback. Updates refresh the account and header avatar; the customer service worker does not cache these changing private photos. Header uses an accessible disclosure button, inert collapsed content, Escape-to-close/focus restoration and reduced-motion transitions.

Validation: 166 API tests passed, including authenticated/self-only name persistence, invalid/empty/overlong names and ignored role/id/phone fields. Customer production build and repository CI are checked during release. No database migration is needed.
