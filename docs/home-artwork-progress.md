# Image-backed home template progress

All ten template IDs now use generated raster artwork in the shared Customer/Admin stylesheet. Original service routing and rotation settings remain unchanged. Background assets are in packages/shared/home-artwork-assets. Generation used the built-in image tool, with the saved body-XX.png references. Prompts requested extraction of the exact paper object, removal of all text/icons, preserved cream/gold material and transparent backgrounds.

Browser captures: C:/Users/xrist/.codex/visualizations/2026/11/04/01a1a8f1-f565-7741-9edd-77611eb1757f/dynamic-home-implementation/image-backed/template-XX.jpg. All ten Admin previews rendered with four live-text sample options. Admin and Customer type checks passed.

Remaining before production: normalize transparent padding and optimize PNG payloads; compare matched light-theme customer viewport to approved source for all ten; correct connector end cap and exact spacing; verify one-to-six entries and large text; publish PR. No production deployment has occurred.
