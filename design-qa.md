# Design QA

final result: blocked

Source: saved peebee-home-graphics/bodies/body-XX.png for 04,07,08,09,11,12,16,17,18,20.
Implementation: local Admin at http://localhost:3002/settings/home-templates, captures in dynamic-home-implementation/image-backed/template-XX.jpg.
Viewport: 390x1000; Admin dark theme with sample shortcuts. Source uses light customer screens with different module labels, so these captures verify rendering but are not a valid pixel-fidelity comparison.

All ten templates render raster objects with live text. Typography remains the common sans-serif requested by the user, intentionally differing from the serif headings in original 11/12. Header/navigation source is untouched.

[P2] Exact layout comparison, transparent padding normalization, connector final end cap, 1-to-6 shortcut counts and large-text coverage remain pending. Asset optimization also remains pending. This is an implementation draft, not a completed fidelity sign-off.

## Ticket correction, 2026-11-05
The ride CTA now reads Where to?; lower ticket rows use action copy. The pin/route raster is enlarged as one asset. Ticket artwork is split at its existing perforation so that its position follows the hero rather than stretching with list length; lower rows start below it. Additional inner gutters apply to text, icons and arrows across templates. Shared TypeScript passed. Browser verification of the latest ticket is pending: the browser connector returned browser.user unavailable. Do not treat this as final visual sign-off.
