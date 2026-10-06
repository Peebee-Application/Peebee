# Food business cover pages

Each customer-facing Food business page now starts with a 9:16 portrait cover, business name/cuisine and a View menu link. Businesses without an uploaded image have a named placeholder. Owners choose, preview and save their cover under Account; Admin Food previews display the same cover. JPG, PNG and WebP images up to 4 MB are accepted. The original image is preserved and centre-cropped visually inside the 9:16 frame.

Uploads select the business by the authenticated owner, never a supplied business ID. Pending covers are restricted to owners and authorized Admin users. Approved covers are available only in the active platform environment. Cover replacement uses a new object key to avoid stale image caches. Uploading a cover does not change the timestamp used for scheduled opening/closing overrides. No migration: the existing cover_key column is used.

Validation on 2026-10-06:

- Database/R2 integration test: owner isolation, rejected file types, persisted replacement keys, protected pending/Admin/environment reads, streamed image content/private headers and preserved working-hours timestamp.
- Phone browser: choose a local sample, portrait preview, save confirmation, saved image reload; measured frame ratio 9:16 within pixel rounding. Tailwind configurations explicitly include the shared cover component.
- Temporary local API fixture removed before release. No production business covers were uploaded during verification.
