# Official Peebee artwork

`logo.svg` is the owner-supplied artwork, preserved unchanged. The themed SVGs
use its original black strokes in light mode and white strokes in dark mode,
with the same paths, proportions, and transparent surround. Headers show the
symbol beside **Peebee** in the matching colour; authentication screens show
the symbol alone. The existing app theme selector controls both.

`logo-light.png` and `logo-dark.png` are 1250px raster exports of those SVGs.
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
When changing the source artwork, first regenerate both 1250px PNG intermediates
with an SVG renderer; the dark intermediate changes only `stroke="#000"` to
`stroke="#fff"`. The exporter copies the SVG variants and creates all raster
sizes from those intermediates.
