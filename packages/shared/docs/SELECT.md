# Dropdowns

Use `Select` from `@peebee/shared/select` for single-choice dropdowns in the
Peebee frontends. Their global stylesheets already import `select.css`.
The component uses the app's surface/ink/gold tokens in light and dark themes.

```tsx
import { Select } from "@peebee/shared/select";

<label htmlFor="category">Category</label>
<Select id="category" value={category} onValueChange={setCategory}
  className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5">
  <option value="">Choose a category…</option>
  {categories.map((category) => (
    <option key={category.id} value={category.id}>{category.name}</option>
  ))}
</Select>
```

Options may be direct children, arrays or fragments. Use a linked label or
`aria-label` for every control. `onValueChange` receives the selected string,
not a browser event. `disabled`, disabled options, `required`, `name` and
`form` preserve form behavior. An empty option can reset a selection; required
empty values prevent submission and open the styled menu. `displayValue` can
provide a compact trigger label (e.g. `kg`) while menu options retain full names.

Menus portal outside cards/drawers, avoid viewport edges and scroll long lists.
Radix manages touch interaction, keyboard/typeahead navigation, Escape/outside
dismissal and focus restoration. Keep field fills uniform using `field-box` for
compound controls. Avoid introducing visible native `<select>` controls.
