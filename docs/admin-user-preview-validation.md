# Admin user previews

The Admin Users directory has consistent cards for riders, customers, Food businesses and merchants. Each card offers Approve and Preview; approved accounts show an Approved status and disabled approval action. Existing active customers remain active without introducing a new signup approval requirement. Rider verification and merchant KYC checks remain enforced by their existing approval endpoints. Suspension and other account controls remain on preview pages.

Food businesses now have a dedicated preview with business/owner contact details, full description, food category, address, pickup coordinates, working hours and registration details. Customers have a submitted-profile section alongside orders. Rider previews include submitted names, coordinates, missing-field placeholders and inline ID previews. Merchant previews retain full business/outlet/member/KYC/finance sections and now render image/PDF documents inline. Photos use a protected Admin endpoint with directory permissions; absent files use an icon.

Validation on 2026-10-06:

- Database integration test passes for anonymous/non-admin/restricted-admin denial, submitted Food/customer details, excluded password data, missing records/photos, invalid directory kinds and protected thumbnail streaming with private cache headers.
- API/Admin TypeScript and Admin lint pass; image lint notices reflect authenticated blob images, plus an existing unrelated settings hook warning.
- Phone browser checked Food preview details, approval update, retained Food tab, approved card, placeholder image, wrapped long names and light/dark appearance. Customer card/preview access also checked.
- Local-only test API removed before release; no production user approvals were performed in browser verification.

No database migration or new approval policy.
