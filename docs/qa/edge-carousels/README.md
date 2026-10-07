# Horizontal rows bleed to the page edges

The common edge-carousel layout cancels the enclosing page padding and puts that padding inside the scrolling content. The first and last cards retain the normal inset, while intermediate content is clipped at the actual app-column edge. Featured and Main dishes both retain horizontal scrolling and scroll snapping. The same layout covers the home wallet cards, wallet switcher/recipient rows, saved-place slider and saved-location suggestion chips. Full-width drawers and padded dialogs/cards have explicit gutter variants.

Mobile verification at 390 x 844 with fictional data:

- Both food rails span x=0 through approximately 374.67 CSS px (usable page width with desktop scrollbar); the initial card starts at x=17px. [Initial state](customer-edge-carousel-initial.png).
- Featured scrollLeft=292.67px moves the first card to x=-275.67px while the clipping boundary stays x=0. Main dishes scrollLeft=200 moves its first card to x=-183px, also clipped at x=0. [Scrolled state](customer-edge-carousel-scrolled.png).
- The last featured card finishes approximately 17px before the rail's right edge.
- Wallet switcher spans x=0 to the app edge with a 17px initial inset. The recipient rail cancels the surrounding card padding and reaches the same page boundary, preserving its normal panel inset. Document width equals client width (375px), so there is no horizontal page scrolling.

All fixture APIs and overrides were removed before commit. No production user, order or wallet data was changed. TypeScript, lint and repository CI are checked before release.
