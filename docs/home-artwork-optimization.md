# Home artwork optimization

The 12 active home illustration assets use WebP quality 90 with full-quality
alpha. Their combined size is 1,000,070 bytes, down from 18,825,039 bytes
(94.7%). Six superseded PNG assets and their overridden CSS references were
removed. Existing screensaver photographs already use WebP.

Compression is visually checked, not mathematically lossless. Transparency is
verified byte-for-byte against each resized source. Aspect ratios are preserved;
sources are never enlarged. Artwork is capped at 1170 pixels wide, with small
notes and the route detail capped at 780 pixels. Layout and typography are unchanged.

Run `scripts/optimize-home-artwork.cjs` with `SHARP_MODULE` pointing to Sharp and
`ARTWORK_SOURCE_DIR` pointing to the original PNG directory. Original PNGs remain
available in Git history. The JSON report records dimensions and sizes.

The customer service worker warms stylesheet-referenced images and all home
screensaver photos during installation. Cached CSS is inspected too, so existing
installations receive the same warm-up. Four concurrent downloads limit connection
pressure, individual failures are tolerated, and page responses do not wait for
background image downloads. Hashed artwork uses cache-first delivery; public
photographs use cached delivery with background refresh. Browser storage may be
evicted, and the first download still requires a connection.

Verify caching with `node --test scripts/home-image-cache.test.mjs`.
