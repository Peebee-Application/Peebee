# Peebee account screens — design QA

final result: passed

## Reference and comparison

Source: `C:/Users/Administrator/Documents/PeebeeCodex/.codex-remote-attachments/01a1065a-c941-72a1-9f15-e3791a6a7a87/9e184308-5d40-48e6-93c6-766a66c06a94/1-Photo-1.jpg` (853 × 1280).

The welcome crop (67,350–411,1043) and registration crop (441,234–784,929) were compared with the implementation at 390 × 844. Local evidence: `.auth-qa/reference-comparison.jpg` (1560 × 890), `.auth-qa/sales-welcome-mobile.jpg`, `.auth-qa/sales-signup-mobile-final.jpg`, `.auth-qa/customer-signup-mobile-final.jpg`, `.auth-qa/customer-recovery-mobile.jpg`, `.auth-qa/sales-signup-dark-mobile.jpg`, and `.auth-qa/sales-signup-dark-final.jpg`.

This is an intentional adaptation of the reference's two-screen concept, typography hierarchy, button hierarchy and filled rounded fields. Peebee cream, ink and gold replace green; a generated delivery/market illustration replaces the reference characters. Google is the sole social provider. Admin access remains invitation-only and sales access still requires approval.

## Visual checks

- Welcome: bold left-aligned 34px heading, short description, solid Sign up and outlined Log in actions. Form: compact 30px heading, description, 54px filled fields with 17px corners, Google action and primary submit.
- Fields have no visible external labels; existing labels remain accessible and inputs have meaningful placeholders and accessible names. Solid surface tokens cover the entire input, including password controls.
- Artwork is a sharp 1536 × 1024 WebP (93,166 bytes), clear at the top and masked progressively toward the content. Form artwork uses contain sizing to preserve the rider's head. Horizontal fading softens dark-theme edges.
- Mobile screenshots show both Google and the primary submit action. Longer supporting content scrolls naturally with no horizontal overflow. Desktop stays centered at a readable width.
- Light and dark themes retain existing palette tokens and logo variants. Entry, image float and hover motions are gentle; reduced-motion disables animations and transitions.

## Findings resolved

1. Form artwork cropped the rider's head: switched to contain sizing and adjusted the art region.
2. Long registration headings and repeated sales approval copy pushed actions too low: shortened headings and condensed the duplicate message.
3. Dark artwork had a rectangular edge: added horizontal fading and reduced art opacity while retaining gold.
4. The customer install banner covered Google: account routes now suppress install prompts. Final customer screenshot confirms the action is unobstructed.

## Interaction and implementation checks

Verified welcome → registration/login, Back to welcome, login/registration switching, customer email/phone switching, password reveal/hide and recovery navigation. Google remains rendered after switching forms. Browser error logs were empty in the production customer preview. No real credentials were submitted, accounts created, messages sent or Google account selected during QA.

Shared and all seven app TypeScript checks passed. Sales and customer production builds passed; customer was rebuilt after the banner fix. Existing authentication handlers, activation, verification and approval rules are preserved. No database migration is required.

Illustration source and final generation prompt: `assets/auth/README.md`. Screenshot evidence is local and ignored by Git; the temporary dark-theme preview route was removed.
