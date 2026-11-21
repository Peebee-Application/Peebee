# Order follow-up design review

Final result: partial — remaining manual QA skipped at the user’s explicit request.

## Approved references

Customer tracking with FOLLOW UP footer; four recipient variants with contextual CALL footer and megaphone; full-page arrival; rider idle and held states. The approved revision removes duplicated in-sheet call buttons and explanatory paragraphs below the rider control.

## Observed before the stop request

- Customer recipient selection changed the footer to CALL KITCHEN and CALL TAXI; the main call action was absent from the sheet body.
- Kitchen attention request sent successfully. Relay messaging targeted Sarah N. and displayed the sent message.
- Full-page arrival displayed the order, arrival status, bell/rider icon, I’m coming, Message rider and Back to order. Native dialog prevented focus reaching the underlying page.
- I’m coming delivered an order message to the rider; it was visible in the rider’s conversation.
- Rider idle and held states rendered with role-appropriate navigation. Holding showed Calling customer, Release to stop, elapsed time and a gold progress bar; releasing restored idle.
- Local database records distinguished tap and hold, and recorded a stop on pointer release.
- Customer received the incoming attention dialog; it disappeared when the hold ended.
- Tested mobile viewports included a measured 391 × 844 CSS px and 520 × 1125 CSS px. Browser screenshot output includes host scaling/gutters; these were not treated as app layout.

## Repairs during review

- Replaced simulated modal containers with native dialogs for focus containment.
- Fixed the rider profile loading race that could redirect a complete rider profile away from a job deep link.
- Removed a stray numeric zero from the tracking location fallback.
- Styled the progress element’s browser-specific fill gold.
- Reduced arrival spacing after phone-size review. This last spacing adjustment and the final Close navigation wording were not reverified after the request to skip further tests.

## Evidence

Local screenshots: `.audit-local/follow-up-kitchen.jpg`, `.audit-local/follow-up-relay.jpg`, `.audit-local/rider-ready.jpg`, `.audit-local/rider-holding.jpg`, `.audit-local/arrival.jpg` and `.audit-local/incoming-attention.jpg`. Local fixtures use fictional people and orders, not live customer records. Screenshots are excluded from the feature commit.

## Limits

No live-phone background, closed-app audio or device vibration acceptance test was completed. Continuous tone/vibration requires the receiving app to remain open with audio unlocked and vibration supported by the device. Background web push uses the device notification sound. Stop delivery has the configured polling/network latency, with a short expiry if connectivity is lost.
