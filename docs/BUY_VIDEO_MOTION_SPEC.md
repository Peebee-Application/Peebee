# Buy reference video: frame-checked motion spec

Source: the 43-second, 720×1280 shopping-app concept video the product owner supplied as the look-and-motion reference for the Buy home.
Method: the video was sampled at 1 frame per second (contact sheets in `docs/reference/buy-video/`, one cell per second, row-major, 6 per row). Easing and exact durations are **not** measurable at that rate; the numbers below are estimates marked `~`. Re-sample with `ffmpeg -vf fps=10` before tuning a transition.

All brand names in the video (Amazon, Prime, Lens, Nike, Adidas, JBL) are sample content and never ship. Peebee names, Peebee colours (cream, ink, gold, `surface-*`), light and dark mode, and admin-controlled content apply. The Peebee header and bottom nav are **not** redesigned or re-animated (see rule 1).

## Rules for anyone implementing or reviewing this

1. **The bottom nav never moves in the video.** It is visible during the home feed, Lens, collection pages, full-screen reels and tab changes. Only the cart sheet covers it. Do not add nav slide-away or a sliding nav highlight. The active icon simply turns filled/white.
2. White circles in the video are **touch indicators** from the recording, not UI.
3. The video never shows a product page. Do not infer one.
4. The cart sheet closes from the chevron. No swipe-to-delete, drag-to-close or rolling number is visible. Those are optional extras, not "video-accurate".
5. The cart count in the video reads **8** (badge, title, `Checkout (8)`).

## Timeline

| Sec | What is on screen | Motion to reproduce |
|---|---|---|
| 0–1 | Home top: brand/location bar, translucent grey search pill (search, camera, mic), greeting, member badge, filter pills, hero slide 1, quick-action pills | Finger scrolls up. The brand/location bar scrolls away. |
| 2 | Search is now pinned at the top as a dark pill with a white outline. Hero shows slide 2 (yellow, different artwork). | Search morphs from translucent glass to solid pill when it pins. Hero swipes sideways between at least 3 slides. |
| 3 | Hero back on slide 1 | Hero snaps with a spring. The pagination dot is a stretched pill that slides, not a dot that jumps. |
| 4–5 | Scrolled to Popular Deals grid, promo banner, brand section ("See all"), Featured Deals | Content slides under the pinned search. Cards dim slightly when pressed (touch glow). |
| 6 | Tap on the camera icon in the search pill | Press ripple on the icon. |
| 7 | Camera screen (back, title, help) with scan brackets, round shutter with a search icon, gallery thumbnail as a grey placeholder, thin progress line along the bottom | Home cross-fades/zooms into the camera. Bottom nav stays. |
| 8 | Brackets move and resize onto another object | Brackets re-lock; they animate position and size. |
| 9 | Three object chips (book, plant, planter) pop in at the bottom-left | Chips spring in one after another. |
| 10 | A result card slides up from the bottom (image, rating, title, price, chevron) | Slide-up with ease-out. |
| 11 | Back button pressed | Camera leaves, home returns where it was. |
| 12–13 | Home scrolled to the brand section; tap on it | Press state on the section. |
| 14 | Collection page: back, title, menu; pills (active chip with a clear-x, two more); big hero card with brand badge and caption, next card peeking; 2×2 grid; page dots | Page pushes in from the right; home moves back. |
| 15 | Scrolled: title row gone, **filter pills pinned** (clear-x chip, pills, filter icon) | Top bar collapses upward; pill row stays. |
| 16–17 | Best Sellers rail, promo banner, "Amazon's Choice" vertical list | Banner gradient shifts as it scrolls. |
| 18 | A Best Sellers card **expands in place**: lifts to a light surface, shows a **+** quick-add button and colour swatches | In-place card expand (no page change in the video). |
| 19 | Card collapsed again | Reverse. |
| 20–22 | Back arrow pressed, a dark in-between frame, then home | Collection pops out to the right; home returns. |
| 23–24 | Inspiration tab: back, large title, search, category pills (active one white), tall feed cards, floating **+** button | Tab change slides horizontally. Active nav icon turns filled. |
| 26 | Feed scrolled; **category pills pinned**, title scrolled away | Same collapse as the collection page. |
| 28–29 | A feed card expands to full screen: glass creator pill at top, caption text reflows, action icons, row of 3 product thumbnails rises | Card grows to full screen (~0.4 s). **Bottom nav stays.** |
| 30–31 | Product mini-card (image, rating, title, price) with a thin progress bar along the bottom | Mini-card rises from the bottom. |
| 32 | Back to the feed | Card shrinks back into the feed. |
| 33–34 | Tap "Plants": active pill moves, feed content swaps (photo, title); tap "Fitness" to return | Pill highlight slides; content cross-fades. |
| 35 | Tap Home: home appears offset horizontally | Horizontal slide between tabs. |
| 36–37 | Cart tapped: home blurs heavily and darkens; sheet with 3 rows rises and covers the nav | Sheet slides up ~60% height; rows settle; pinned footer with subtotal and orange Checkout. |
| 38–39 | Tap on a row's colour swatch: **swatch options expand inline** (3 colours) | Inline swatch picker; the selection updates the row's swatch. |
| 40–41 | Sheet settled; chevron highlighted | Close by tapping the chevron. |
| 42 | Home again, nav and search visible | Sheet slides down, blur clears. |

## Acceptance checklist (each item is pass or fail, with a recording)

- [ ] Nav identical to `main` in every state; not hidden or animated during reels, product-card expand or collections.
- [ ] Brand/location bar scrolls away, search pins and changes from glass to solid.
- [ ] Hero: three or more admin-set slides, spring snap, sliding pill indicator.
- [ ] Collection push from the right; pills pin; clear-x chip works.
- [ ] Product card expands in place with quick-add and colour swatches when the product has variants.
- [ ] Reel card expands to full screen with the nav still visible; shoppable thumbnails then mini-card.
- [ ] Cart sheet over a blurred home; inline swatch picker; chevron close.
- [ ] Camera screen: scan brackets, thumbnail placeholder, progress line, chips, result card (behind its admin switch).
- [ ] Reduced motion replaces every movement with a short fade.
- [ ] Light and dark mode both checked.

## Corrections to earlier internal write-ups

Earlier summaries said the nav slides away when a reel opens, that the nav has a sliding highlight, that the cart count is 3, that the cart supports swipe-to-delete and drag-to-close, and that white dots scan across the Lens view. The frames above show none of these.
