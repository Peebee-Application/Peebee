# Rider job screens and payment confirmation

The rider job detail screen chooses its presentation from the order kind and current stage. Passenger rides never enter the goods shopping/delivery view, even before the backend changes Shop to Deliver.

| Journey | Current destination | Main bottom action |
| --- | --- | --- |
| Passenger pickup | Passenger pickup address | Navigate to pickup, then At pickup |
| Passenger boarding | Pickup address | Passenger on board |
| Passenger intermediate stop | Next unfinished stop | Navigate to stop, then At stop / Continue trip |
| Passenger drop-off | Passenger destination | Navigate to drop-off, then Confirm drop-off |
| Passenger completion | Destination | Wait for passenger confirmation, then Settle trip |
| Shopping list | Shopping merchant | Start delivery after purchases and approvals |
| Food collection | Assigned food outlet | Confirm food pickup |
| Store collection | Assigned store | Confirm item pickup |
| Parcel collection | Sender pickup address | Confirm parcel pickup |
| First-mile relay | Taxi handoff stage | Show handoff code; taxi confirms receipt |
| Last-mile relay | Taxi / station collection point | Confirm collection using the existing code |
| Goods delivery | Customer destination | Navigate to customer, then Close navigation |
| Goods arrival | Customer handoff point | Call the selected party; tap/hold retains existing attention settings |

The existing brand header stays visible. The existing navigation capsule becomes the current job action with a Back to jobs control. On leaving the job or completing it, the normal tabs return. Navigation sessions use separate keys for passenger pickup, individual stops, and drop-off. Missing coordinates permit explicit arrival confirmation using the displayed address.

Cards use existing charcoal/gold tokens, subtle borders and surface gradients. Job typography uses the existing Roboto asset. Supplemental shopping, QR payment, substitutions, fee negotiation, bundled pickups and relay verification remain available; backend validation and settlement ownership are unchanged. No migration is required.

The customer payment page has one confirmation slider, in the bottom navigation. Dragging clips the original text and reveals Processing... behind the handle. While a request or provider payment is pending, the white handle stays at the right with chevrons and an animated loading ring. Failure restores the initial position for retry. The configured confirmation threshold and keyboard/screen-reader controls remain in use. Cash selection is not represented as money received.

## Handoff

Customer and rider production builds completed. Full rider lint reports existing repository errors; the focused component review reported no new component lint errors (the two existing payment/job pages retain their prior hook-rule findings). A sample-data preview was inspected at 390px and 360px in dark mode, then removed. The user elected to perform functional and device testing; no completed live payment, ride, relay, or notification test is claimed.
