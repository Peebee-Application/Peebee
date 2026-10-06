# Official Peebee artwork

`logo.svg` is the owner-supplied artwork, preserved unchanged. The themed SVGs
use its original black ink in light mode and white ink in dark mode, with the
supplied gold gradient,
with the same paths, proportions, and transparent surround. Headers show the
symbol beside **Peebee** in the matching colour. Authentication welcome screens
show the wordmark; form screens retain the icon-only back arrow without a logo.
The existing app theme selector controls both themed assets.

`logo-light.png` and `logo-dark.png` are 1260px raster exports of those SVGs.
They supply the older `peebee-logo-light.png`, `peebee-logo-dark.png`,
`peebee-logo-navy.png`, and `peebee-logo-white.png` addresses so email and older
links also show the new artwork.

Browser tabs use a vector favicon that is black or white according to the
browser's colour preference. Installed apps use the black symbol on a solid
white background in their 180px Apple touch icon and 192px/512px app icons.
The 32px PNG favicon remains available for compatibility. Icon URL versions
and service-worker cache versions change together for existing installations.

To regenerate published assets on Windows, run
`powershell -File assets/brand/export-icons.ps1` from the repository root.
When changing the source artwork, first run `node assets/brand/render-svg.cjs`
with an optional second argument pointing to a real `sharp` module (the workspace
deployment stub cannot render images). This resolves the source's CSS variables
for raster compatibility, preserving its paths and default gold gradient.
The exporter forces `data-theme` on header SVGs so the app theme takes priority
over the OS preference. The favicon preserves the source's automatic theme.
It creates all raster sizes from those intermediates.
