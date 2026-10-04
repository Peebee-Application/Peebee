# Official Peebee artwork

The original files supplied by the owner are preserved here unchanged:

- `logo-light.png`: plain logo for light theme, favicon, and installed app icon.
- `logo-dark.png`: white-stroked logo for dark theme.

Each frontend publishes 256px PNG versions for its themed logo. Headers render
the symbol with the text **Peebee** on its right; authentication screens render
the symbol alone. Existing `peebee-logo-navy.png` and `peebee-logo-white.png`
addresses remain aliases of the supplied artwork for older links and emails.

The light logo also supplies the 32px favicon, 180px Apple touch icon, and
192px/512px app icons, preserving the original proportions on a solid white background.
Icon URL versions and the service-worker cache version change together so
existing installations can fetch updated artwork.

Header logo exports preserve the source PNG transparency around the solid symbol.
Favicon and installed app icons are RGB images without an alpha channel.
To regenerate all exports on Windows, run
`powershell -File assets/brand/export-icons.ps1` from the repository root.
The exporter clamps resizing at image edges to preserve the artwork.
