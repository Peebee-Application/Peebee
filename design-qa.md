# Rider home visual review

Source visual truth: user-selected `Photo 1.jpg`, supplied October 3, 2026, at
`C:/Users/Administrator/Documents/Peebee-GPT/.codex-remote-attachments/01a0fc23-1770-73b2-b878-eebdb62bc2a2/94f51ee9-fd2e-457b-abec-8ad7caa2b8fe/1-Photo-1.jpg`.

Target state: light theme, online rider, two available jobs, one active job,
home savings placement, five bottom navigation items. Intended mobile viewport:
390 × 844 CSS pixels; also check 320px widths, Luganda, and dark theme.

## Findings

- Visual verification is blocked. No valid implementation screenshot of the
  selected home state was captured, so there is no full-view or focused-region
  comparison, and density normalization has not been completed.
- Local sample-data preview attempts encountered stale PWA development assets
  and slow Next.js compilation. An incomplete mock response also caused an
  unrelated account-screen error; this was corrected in the local fixture.
- Automatic approval review rejected starting the completed production preview
  with `blocked by policy`. Do not treat build success as visual verification.

## Implemented design intent — still requires visual comparison

- Typography: existing system font; 24px greeting, 20px section headings,
  16px job names, 18px amounts, 14px action labels. No oversized money hero.
- Layout: 20px gaps between job cards, 24px between major home sections,
  16px within section groups, 14px card padding, and 48px action targets.
- Colors: existing cream, ink, gold, green availability and theme-aware surface
  tokens. Existing five-tab navigation remains, with optional admin-placed RSLA.
- Assets: supplied Peebee brand logo and existing Lucide library icons.
- Content: live job titles, separate total/delivery fee, distances only where
  the API supplies them, actual job stage labels, and translated new labels.

## Validation

- Final rider TypeScript check passed after all presentation refinements.
- Rider production build completed successfully, including type and lint checks.
  Existing savings hook and logo image warnings remain.
- Temporary local API fixture and preview routing were not included in the change.
- Primary home interactions, responsive layout, dark/light comparison, Luganda
  wrapping, six-tab savings placement, and final console-error check remain
  unverified in the browser. Existing claim, apply, bid, sort, preview, availability,
  and savings-placement logic was preserved.

## Comparison history

No valid home comparison iteration exists. Account/login observations are not
evidence that the home screen matches the reference.

## Implementation checklist

1. Open the rider app with a verified sample rider and matching job fixtures.
2. Capture and normalize the selected image and rendered home at the same size.
3. Compare typography, spacing, colors, assets and content in a combined image.
4. Verify filtering, every sort choice, preview, claim/apply, bids, online switch,
   continuation, and admin-configured savings placement.
5. Check small widths, long labels, dark theme, Luganda, empty and offline states.
6. Fix any P0/P1/P2 discrepancies and capture the revised state before approval.

final result: blocked
