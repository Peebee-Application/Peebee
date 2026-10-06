# Food menu builder verification

Verified on 6 October 2026 with fictional local menu data at a 390px phone viewport. Temporary fixtures and API overrides are excluded from the release.

## UI workflow checked

- Empty menu offers a clear first-dish action.
- Missing name produces guidance before any save.
- A new section can be created inside dish setup and selected immediately.
- A photo can be selected and previewed before the dish exists.
- Size template supports Regular/Large with a UGX 5,000 surcharge; required and multiple-choice settings are visible.
- Customer preview shows price, photo, section and choice rules.
- Save-and-add-another persists the dish and opens a blank form retaining its section.
- A dish with no photo or choices can also be saved.
- Availability switches update the overview and available count.
- Editing price preserves existing choices and photo; unsaved edits prompt before closing.
- Renaming a section updates its heading/filter. Removing it retains both dishes under No section.
- Search filters saved dishes by name.
- Dialog opens with focus on Close and restores focus to the opening control when closed.

## Save correctness

Three automated tests cover validation before persistence, failed photo upload followed by retry against the acknowledged item ID, and clearing optional fields while retaining unavailable status. A new or edited dish remains unavailable during the multi-request save until choices and photo finish. A failed first create request without an acknowledged ID is outside this client checkpoint guarantee.

Existing backend ownership, business approval and menu contracts are unchanged. No migration is needed.

## Visual evidence

Local screenshots saved beside the repository:

- `../../menu-basics-final.png`: inline photo, currency field and full-width section selector.
- `../../menu-preview-final.png`: customer preview and save actions.
- `../../menu-overview-final.png`: searchable menu and availability controls.

All screenshots were inspected. Fixed navigation in full-page captures sits at the viewport boundary; normal scrolling exposes the remaining rows.
