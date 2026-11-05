"use client";

import {
  ApiError,
  type MenuCategory,
  type MenuItem,
  type RestaurantMenu,
} from "@peebee/shared";
import {
  Camera,
  Check,
  ChevronRight,
  FolderOpen,
  Plus,
  Search,
  Settings2,
  UtensilsCrossed, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MenuItemEditor } from "../../components/MenuItemEditor";
import { MenuPhoto } from "../../components/MenuPhoto";
import { Modal } from "../../components/Modal";
import { api, errorMessage } from "../../lib/api";

const money = (value: number) => `UGX ${value.toLocaleString("en-UG")}`;

function SectionManager({
  categories,
  onClose,
  onChanged,
}: {
  categories: MenuCategory[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [rename, setRename] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [remove, setRemove] = useState<MenuCategory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  async function change(action: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      setName("");
      setRename(null);
      setRemove(null);
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Menu sections"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-500">
          Group dishes so customers can find what they want. Removing a section
          keeps its dishes under “No section”.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              name.trim() &&
              !categories.some(
                (category) =>
                  category.name.toLowerCase() === name.trim().toLowerCase(),
              )
            )
              void change(() => api.createMenuCategory({ name: name.trim() }));
            else setError("Use a new section name.");
          }}
          className="space-y-2"
        >
          <input
            aria-label="New menu section name"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New section · e.g. Breakfast"
            disabled={busy}
            className="min-h-12 w-full rounded-2xl px-3 text-sm"
          />
          <button
            disabled={busy || !name.trim()}
            className="min-h-11 rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-50"
          >
            Add section
          </button>
        </form>
        {categories.map((category) => (
          <div
            key={category.id}
            className="space-y-2 rounded-2xl border border-[var(--border-faint)] p-3"
          >
            {rename?.id === category.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (rename.name.trim())
                    void change(() =>
                      api.updateMenuCategory(category.id, {
                        name: rename.name.trim(),
                      }),
                    );
                }}
                className="space-y-2"
              >
                <input
                  aria-label={`Rename ${category.name}`}
                  maxLength={120}
                  value={rename.name}
                  disabled={busy}
                  onChange={(event) =>
                    setRename({ id: category.id, name: event.target.value })
                  }
                  className="min-h-12 w-full rounded-xl px-3 text-sm"
                />
                <div className="flex gap-4">
                  <button
                    disabled={busy || !rename.name.trim()}
                    className="min-h-11 text-sm font-bold text-gold"
                  >
                    Save name
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRename(null)}
                    className="min-h-11 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="font-bold">
                  {category.name}{" "}
                  <span className="text-xs font-normal text-ink-500">
                    {category.items.length} dishes
                  </span>
                </p>
                <div className="flex gap-4">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setRename({ id: category.id, name: category.name })
                    }
                    className="min-h-11 text-sm font-bold text-gold"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRemove(category)}
                    className="min-h-11 text-sm text-ink-500"
                  >
                    Remove section
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
        {remove && (
          <div className="space-y-2 rounded-2xl border border-[var(--border-faint)] p-3">
            <p className="text-sm">
              Remove “{remove.name}”? Its dishes will remain on your menu.
            </p>
            <div className="flex gap-4">
              <button
                disabled={busy}
                onClick={() =>
                  void change(() => api.deleteMenuCategory(remove.id))
                }
                className="min-h-11 text-sm font-bold text-gold"
              >
                Remove section
              </button>
              <button
                disabled={busy}
                onClick={() => setRemove(null)}
                className="min-h-11 text-sm"
              >
                Keep section
              </button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm text-ink-500">
            Saving sections…
          </p>
        )}
      </div>
    </Modal>
  );
}

function DishRow({
  item,
  onEdit,
  onToggle,
  onFeature,
  busy,
  photoRevision,
}: {
  item: MenuItem;
  onEdit: () => void;
  onToggle: () => void;
  onFeature: () => void;
  busy: boolean;
  photoRevision: number;
}) {
  return (
    <article className="home-card !rounded-3xl !p-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${item.name}`}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div className="w-24 shrink-0 overflow-hidden rounded-xl">
            <MenuPhoto id={item.id} hasPhoto={!!item.photo_key} revision={photoRevision} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-xl font-extrabold leading-tight">{item.name}</h3>
            <p className="mt-1 text-lg font-bold tabular-nums">{money(item.price)}</p>
            {!item.photo_key && <p className="text-base text-ink-500">Add a photo</p>}
          </div>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={!!item.is_featured}
          aria-label={`${item.name} featured`}
          disabled={busy}
          onClick={onFeature}
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${item.is_featured ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink-500"}`}
        >
          <Star className={`h-6 w-6 ${item.is_featured ? "fill-current" : ""}`} aria-hidden />
        </button>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!item.available}
        aria-label={`${item.name} available to order`}
        onClick={onToggle}
        disabled={busy}
        className={`mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-lg font-bold disabled:opacity-50 ${item.available ? "bg-green/15 text-green" : "bg-[rgb(var(--surface-muted))] text-ink-500"}`}
      >
        {busy ? "Updating…" : item.available ? (<><Check className="h-6 w-6" aria-hidden />Available</>) : "Sold out"}
      </button>
    </article>
  );
}

export default function MenuPage() {
  const router = useRouter();
  const [menu, setMenu] = useState<RestaurantMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [photoRevisions, setPhotoRevisions] = useState<Record<string, number>>(
    {},
  );
  const [query, setQuery] = useState("");
  const [selectedSection, setSelectedSection] = useState("all");
  const [shown, setShown] = useState(8);
  const [managing, setManaging] = useState(false);
  const [updating, setUpdating] = useState<Set<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const [editing, setEditing] = useState<{
    key: number;
    item: MenuItem | null;
    categoryId: string | null;
  } | null>(null);
  const editorKey = useRef(0);
  const load = useCallback(async () => {
    try {
      const result = await api.myMenu();
      setMenu(result);
      setError(null);
      setSelectedSection((previous) =>
        previous === "all" ||
        previous === "none" ||
        result.categories.some((category) => category.id === previous)
          ? previous
          : "all",
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404)
        router.replace("/account");
      else setError(errorMessage(err));
    }
  }, [router]);
  useEffect(() => {
    void load();
  }, [load]);
  const categories = menu?.categories ?? [];
  const items = [
    ...categories.flatMap((category) => category.items),
    ...(menu?.uncategorizedItems ?? []),
  ];
  function openEditor(item: MenuItem | null, categoryId: string | null) {
    setNotice("");
    setEditing({ key: ++editorKey.current, item, categoryId });
  }
  async function toggle(item: MenuItem,featured=false) {
    if (inFlight.current.has(item.id)) return;
    inFlight.current.add(item.id);
    setUpdating(new Set(inFlight.current));
    setError(null);
    try {
      await api.updateMenuItem(item.id, featured?{featured:!item.is_featured}:{ available: !item.available });
      await load();
      setNotice(
        featured?`${item.name} ${item.is_featured?"removed from":"added to"} featured dishes.`:`${item.name} is now ${item.available ? "unavailable" : "available to order"}.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlight.current.delete(item.id);
      setUpdating(new Set(inFlight.current));
    }
  }
  const sections = [
    ...categories.map((category) => ({
      id: category.id,
      name: category.name,
      items: category.items,
    })),
    { id: "none", name: "No section", items: menu?.uncategorizedItems ?? [] },
  ];
  const visible = sections
    .filter(
      (section) => selectedSection === "all" || selectedSection === section.id,
    )
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        `${item.name} ${item.description ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    }));

  return (
    <div className="space-y-5 px-4 pb-8 pt-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold">Menu</h1>
        <button
          type="button"
          disabled={!menu}
          onClick={() =>
            openEditor(
              null,
              selectedSection === "all" || selectedSection === "none"
                ? null
                : selectedSection,
            )
          }
          className="flex min-h-14 shrink-0 items-center gap-2 rounded-full bg-gold px-5 text-lg font-bold text-ink-gold disabled:opacity-50"
        >
          <Plus size={24} />
          Add dish
        </button>
      </header>
      {menu && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-base">
          <p className="text-ink-500">
            {items.length} dish{items.length === 1 ? "" : "es"} ·{" "}
            {items.filter((item) => item.available).length} available
          </p>
          <button
            type="button"
            onClick={() => setManaging(true)}
            className="flex min-h-12 items-center gap-2 text-base font-bold text-gold"
          >
            <Settings2 size={20} />
            Sections
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-2xl bg-gold/10 p-3 text-sm">
          {notice}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="space-y-2 rounded-2xl border border-[var(--border-faint)] p-3"
        >
          <p className="text-sm">{error}</p>
          <button
            onClick={() => void load()}
            className="min-h-11 text-sm font-bold text-gold"
          >
            Try again
          </button>
        </div>
      )}
      {!menu && !error && (
        <p role="status" className="py-10 text-center text-sm text-ink-500">
          Loading your menu…
        </p>
      )}
      {menu && !items.length && (
        <section className="space-y-4 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-6">
          <UtensilsCrossed className="text-gold" size={32} />
          <h2 className="text-xl font-bold">Your first dish starts here.</h2>
          <p className="text-sm text-ink-500">
            Add a name and price, choose a photo, then preview. Create sections
            as you go.
          </p>
          <button
            onClick={() => openEditor(null, null)}
            className="min-h-12 rounded-full bg-gold px-5 text-sm font-bold text-ink-gold"
          >
            Create your first dish
          </button>
          <div className="flex flex-wrap gap-4 text-xs text-ink-500">
            <span className="flex items-center gap-1">
              <Camera size={14} />
              Photos before saving
            </span>
            <span className="flex items-center gap-1">
              <FolderOpen size={14} />
              Easy menu sections
            </span>
          </div>
        </section>
      )}
      {menu && items.length > 0 && (
        <>
          <div className="field-box flex min-h-14 items-center gap-2 rounded-2xl px-4 text-lg">
            <Search size={22} className="shrink-0 text-ink-500" />
            <input
              aria-label="Search your dishes"
              placeholder="Find a dish…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 border-0 outline-none"
            />
          </div>
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            aria-label="Filter menu sections"
          >
            {[
              { id: "all", name: "All dishes", count: items.length },
              ...sections
                .filter(
                  (section) => section.items.length || section.id !== "none",
                )
                .map((section) => ({
                  id: section.id,
                  name: section.name,
                  count: section.items.length,
                })),
            ].map((section) => (
              <button
                key={section.id}
                type="button"
                aria-pressed={selectedSection === section.id}
                onClick={() => setSelectedSection(section.id)}
                className={`min-h-12 shrink-0 rounded-full border px-5 text-base font-bold ${selectedSection === section.id ? "border-gold bg-gold/15 text-ink" : "border-[var(--border-faint)] text-ink-500"}`}
              >
                {section.name} · {section.count}
              </button>
            ))}
          </div>
          {(() => { let left = shown; return visible.map((section) => { const sectionItems = section.items.slice(0, Math.max(0, left)); left -= sectionItems.length; return { ...section, items: sectionItems, full: section.items.length }; }); })().map((section) =>
            section.items.length ? (
              <section key={section.id} className="space-y-3">
                <h2 className="text-lg font-extrabold text-ink-500">
                  {section.name}
                </h2>
                <div className="space-y-3">
                  {section.items.map((item) => (
                    <DishRow
                      key={item.id}
                      item={item}
                      onEdit={() => openEditor(item, item.category_id ?? null)}
                      onToggle={() => void toggle(item)}
                      onFeature={() => void toggle(item,true)}
                      busy={updating.has(item.id)}
                      photoRevision={photoRevisions[item.id] ?? 0}
                    />
                  ))}
                </div>
              </section>
            ) : selectedSection === section.id && !query ? (
              <div
                key={section.id}
                className="rounded-2xl border border-[var(--border-faint)] p-5 text-sm text-ink-500"
              >
                No dishes in this section yet. Tap Add dish to start.
              </div>
            ) : null,
          )}
          {visible.reduce((n, section) => n + section.items.length, 0) > shown && (
            <button type="button" onClick={() => setShown((n) => n + 8)} className="min-h-14 w-full rounded-full border border-gold text-lg font-bold text-gold">
              Show more dishes
            </button>
          )}
          {query && !visible.some((section) => section.items.length) && (
            <p className="py-8 text-center text-sm text-ink-500">
              No dishes match “{query}”.
            </p>
          )}
        </>
      )}
      {managing && (
        <SectionManager
          categories={categories}
          onClose={() => setManaging(false)}
          onChanged={load}
        />
      )}
      {editing && (
        <MenuItemEditor
          key={editing.key}
          item={editing.item}
          categoryId={editing.categoryId}
          categories={categories}
          onClose={() => {
            setEditing(null);
            void load();
          }}
          onCategoryCreated={(category) =>
            setMenu((previous) =>
              previous
                ? {
                    ...previous,
                    categories: [
                      ...previous.categories,
                      { ...category, items: category.items ?? [] },
                    ],
                  }
                : previous,
            )
          }
          onSaved={(another, categoryId, photoItemId) => {
            if (photoItemId)
              setPhotoRevisions((previous) => ({
                ...previous,
                [photoItemId]: Date.now(),
              }));
            void load();
            setNotice(
              another
                ? "Dish saved. Add your next one."
                : "Your menu has been updated.",
            );
            if (another)
              setEditing({ key: ++editorKey.current, item: null, categoryId });
            else setEditing(null);
          }}
        />
      )}
    </div>
  );
}
