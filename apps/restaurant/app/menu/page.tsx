"use client";

import { Select } from "@peebee/shared/select";

import { ApiError } from "@peebee/shared";
import type { MenuCategory, MenuItem, MenuItemBadge, MenuItemOption, RestaurantMenu } from "@peebee/shared";
import { Camera, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../../components/Modal";
import { api, errorMessage } from "../../lib/api";
import { compressImage } from "../../lib/image-compress";

function formatUgx(n: number): string {
  return `UGX ${n.toLocaleString("en-UG")}`;
}

type EditableOption = {
  key: string;
  name: string;
  required: boolean;
  multiSelect: boolean;
  choices: { key: string; name: string; priceDelta: string }[];
};

function optionsFromItem(item: MenuItem | null): EditableOption[] {
  if (!item) return [];
  return item.options.map((o: MenuItemOption) => ({
    key: o.id,
    name: o.name,
    required: !!o.required,
    multiSelect: !!o.multi_select,
    choices: o.choices.map((c) => ({ key: c.id, name: c.name, priceDelta: String(c.price_delta) })),
  }));
}

let uid = 0;
function nextKey() {
  uid += 1;
  return `new-${uid}`;
}

function ItemEditor({
  item,
  categoryId,
  categories,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** Null when creating a new item. */
  item: MenuItem | null;
  /** Preselected category when creating from inside a category section. */
  categoryId: string | null;
  categories: MenuCategory[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(item?.category_id ?? categoryId ?? "");
  const [available, setAvailable] = useState(item ? !!item.available : true);
  const [prepTime, setPrepTime] = useState(item?.prep_time_minutes != null ? String(item.prep_time_minutes) : "");
  const [badge, setBadge] = useState<MenuItemBadge | "">(item?.badge ?? "");
  const [options, setOptions] = useState<EditableOption[]>(optionsFromItem(item));
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!item?.photo_key) {
      setPhotoUrl(null);
      return;
    }
    let revoked = false;
    api
      .menuItemPhotoBlob(item.id)
      .then((blob) => {
        if (!revoked) setPhotoUrl(URL.createObjectURL(blob));
      })
      .catch(() => {});
    return () => {
      revoked = true;
    };
  }, [item?.id, item?.photo_key]);

  function addOption() {
    setOptions((prev) => [
      ...prev,
      { key: nextKey(), name: "", required: false, multiSelect: false, choices: [{ key: nextKey(), name: "", priceDelta: "0" }] },
    ]);
  }
  function removeOption(key: string) {
    setOptions((prev) => prev.filter((o) => o.key !== key));
  }
  function updateOption(key: string, patch: Partial<EditableOption>) {
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }
  function addChoice(optionKey: string) {
    setOptions((prev) =>
      prev.map((o) => (o.key === optionKey ? { ...o, choices: [...o.choices, { key: nextKey(), name: "", priceDelta: "0" }] } : o)),
    );
  }
  function removeChoice(optionKey: string, choiceKey: string) {
    setOptions((prev) =>
      prev.map((o) => (o.key === optionKey ? { ...o, choices: o.choices.filter((c) => c.key !== choiceKey) } : o)),
    );
  }
  function updateChoice(optionKey: string, choiceKey: string, patch: Partial<{ name: string; priceDelta: string }>) {
    setOptions((prev) =>
      prev.map((o) =>
        o.key === optionKey
          ? { ...o, choices: o.choices.map((c) => (c.key === choiceKey ? { ...c, ...patch } : c)) }
          : o,
      ),
    );
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !item) return;
    setUploadingPhoto(true);
    setError(null);
    try {
      const compressed = await compressImage(file);
      await api.uploadMenuItemPhoto(item.id, compressed);
      setPhotoUrl(URL.createObjectURL(compressed));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function save() {
    if (!name.trim() || !price.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        description: description.trim() || undefined,
        price: Math.round(Number(price)),
        categoryId: selectedCategoryId || null,
        available,
        prepTimeMinutes: prepTime.trim() ? Math.round(Number(prepTime)) : undefined,
        badge: badge || null,
      };
      const saved = item ? (await api.updateMenuItem(item.id, input)).item : (await api.createMenuItem(input)).item;
      const validOptions = options.filter((o) => o.name.trim() && o.choices.some((c) => c.name.trim()));
      await api.setMenuItemOptions(saved.id, validOptions.map((o) => ({
        name: o.name.trim(),
        required: o.required,
        multiSelect: o.multiSelect,
        choices: o.choices.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), priceDelta: Number(c.priceDelta) || 0 })),
      })));
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteMenuItem(item.id);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={item ? "Edit item" : "New item"} onClose={onClose}>
      <div className="space-y-4 pb-4">
        {item && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))]"
            >
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
              ) : (
                <Camera className="h-6 w-6 text-ink-500" strokeWidth={1.75} aria-hidden />
              )}
              {uploadingPhoto && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-semibold text-white">
                  Uploading…
                </span>
              )}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500">Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Chicken Luwombo"
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short line about this dish"
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500">Price (UGX) *</label>
            <input
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="15000"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500">Prep time (min)</label>
            <input
              inputMode="numeric"
              value={prepTime}
              onChange={(e) => setPrepTime(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="20"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500">Category</label>
          <Select aria-label="Menu category"
            value={selectedCategoryId}
            onValueChange={(value) => setSelectedCategoryId(value)}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={available}
            onChange={(e) => setAvailable(e.target.checked)}
            className="h-4 w-4 accent-gold"
          />
          <span className="text-sm text-ink">Available (uncheck to 86 this item)</span>
        </label>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink-500">Badge (optional)</label>
          <div className="flex gap-1.5">
            {([
              { value: "", label: "None" },
              { value: "sale", label: "Sale" },
              { value: "new", label: "New" },
              { value: "trending", label: "Trending" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setBadge(opt.value as MenuItemBadge | "")}
                className={`flex-1 rounded-full border px-2 py-2 text-xs font-bold ${
                  badge === opt.value ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] text-ink-500"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-500">Shows as a small pill on the item&apos;s card in the customer app.</p>
        </div>

        <div className="space-y-2 border-t border-[var(--border-faint)] pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Options</p>
            <button type="button" onClick={addOption} className="text-xs font-bold text-gold">
              + Add option
            </button>
          </div>
          <p className="text-xs text-ink-500">e.g. &quot;Size&quot; (required, pick one) or &quot;Extras&quot; (optional, pick several).</p>

          {options.map((option) => (
            <div key={option.key} className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
              <div className="flex items-center gap-2">
                <input
                  value={option.name}
                  onChange={(e) => updateOption(option.key, { name: e.target.value })}
                  placeholder="Option name, e.g. Size"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border-faint)] px-2.5 py-2 text-sm outline-none focus:border-gold"
                />
                <button type="button" onClick={() => removeOption(option.key)} className="shrink-0 text-red-500">
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </button>
              </div>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 text-xs text-ink-500">
                  <input
                    type="checkbox"
                    checked={option.required}
                    onChange={(e) => updateOption(option.key, { required: e.target.checked })}
                    className="h-3.5 w-3.5 accent-gold"
                  />
                  Required
                </label>
                <label className="flex items-center gap-1.5 text-xs text-ink-500">
                  <input
                    type="checkbox"
                    checked={option.multiSelect}
                    onChange={(e) => updateOption(option.key, { multiSelect: e.target.checked })}
                    className="h-3.5 w-3.5 accent-gold"
                  />
                  Pick multiple
                </label>
              </div>
              <div className="space-y-1.5">
                {option.choices.map((choice) => (
                  <div key={choice.key} className="flex items-center gap-2">
                    <input
                      value={choice.name}
                      onChange={(e) => updateChoice(option.key, choice.key, { name: e.target.value })}
                      placeholder="Choice, e.g. Large"
                      className="min-w-0 flex-1 rounded-lg border border-[var(--border-faint)] px-2.5 py-1.5 text-xs outline-none focus:border-gold"
                    />
                    <input
                      inputMode="numeric"
                      value={choice.priceDelta}
                      onChange={(e) => updateChoice(option.key, choice.key, { priceDelta: e.target.value.replace(/[^\d]/g, "") })}
                      placeholder="+0"
                      className="w-20 shrink-0 rounded-lg border border-[var(--border-faint)] px-2.5 py-1.5 text-xs outline-none focus:border-gold"
                    />
                    <button
                      type="button"
                      onClick={() => removeChoice(option.key, choice.key)}
                      className="shrink-0 text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => addChoice(option.key)} className="text-xs font-bold text-gold">
                  + Add choice
                </button>
              </div>
            </div>
          ))}
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex gap-2 pt-1">
          {item && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="min-h-11 rounded-full border border-red-200 px-4 text-sm font-bold text-red-600 disabled:opacity-60"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={busy || !name.trim() || !price.trim()}
            className="min-h-11 flex-1 rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save item"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ItemRow({ item, onClick }: { item: MenuItem; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="home-card flex w-full items-center gap-3 !rounded-2xl !px-3 !py-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-bold text-ink">{item.name}</span>
          {!item.available && (
            <span className="shrink-0 rounded-full bg-[rgb(var(--surface-muted))] px-2 py-0.5 text-[10px] font-semibold text-ink-500">
              86&apos;d
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-500">
          {formatUgx(item.price)}
          {item.options.length > 0 ? ` · ${item.options.length} option${item.options.length === 1 ? "" : "s"}` : ""}
        </span>
      </span>
      <ChevronRight className="h-4.5 w-4.5 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

export default function MenuPage() {
  const router = useRouter();
  const [menu, setMenu] = useState<RestaurantMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [editing, setEditing] = useState<{ item: MenuItem | null; categoryId: string | null } | null>(null);

  const load = useCallback(() => {
    api
      .myMenu()
      .then(setMenu)
      .catch((err) => {
        // No restaurant registered yet — send them to set one up instead of
        // showing a raw "not found" error on a page that assumes one exists.
        if (err instanceof ApiError && err.status === 404) {
          router.replace("/account");
          return;
        }
        setError(errorMessage(err));
      });
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    setAddingCategory(true);
    setError(null);
    try {
      await api.createMenuCategory({ name: newCategoryName.trim() });
      setNewCategoryName("");
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAddingCategory(false);
    }
  }

  async function removeCategory(id: string) {
    setError(null);
    try {
      await api.deleteMenuCategory(id);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const categories = menu?.categories ?? [];
  const uncategorized = menu?.uncategorizedItems ?? [];

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Menu</h1>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex gap-2">
        <input
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder="New category, e.g. Mains"
          className="min-w-0 flex-1 rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
        />
        <button
          onClick={addCategory}
          disabled={addingCategory || !newCategoryName.trim()}
          className="shrink-0 rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
        >
          Add
        </button>
      </div>

      {categories.map((cat) => (
        <section key={cat.id} className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{cat.name}</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setEditing({ item: null, categoryId: cat.id })}
                className="flex items-center gap-1 text-xs font-bold text-gold"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden /> Item
              </button>
              <button onClick={() => removeCategory(cat.id)} className="text-xs font-semibold text-red-500">
                Remove
              </button>
            </div>
          </div>
          {cat.items.length === 0 ? (
            <p className="py-2 text-center text-xs text-ink-500">No items yet.</p>
          ) : (
            <ul className="space-y-2">
              {cat.items.map((item) => (
                <li key={item.id}>
                  <ItemRow item={item} onClick={() => setEditing({ item, categoryId: cat.id })} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Uncategorized</h2>
          <button
            onClick={() => setEditing({ item: null, categoryId: null })}
            className="flex items-center gap-1 text-xs font-bold text-gold"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden /> Item
          </button>
        </div>
        {uncategorized.length === 0 ? (
          <p className="py-2 text-center text-xs text-ink-500">Nothing here.</p>
        ) : (
          <ul className="space-y-2">
            {uncategorized.map((item) => (
              <li key={item.id}>
                <ItemRow item={item} onClick={() => setEditing({ item, categoryId: null })} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <ItemEditor
          item={editing.item}
          categoryId={editing.categoryId}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onDeleted={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
