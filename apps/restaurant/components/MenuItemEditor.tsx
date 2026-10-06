"use client";

import { Select } from "@peebee/shared/select";
import type { MenuCategory, MenuItem, MenuItemBadge } from "@peebee/shared";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { compressImage } from "../lib/image-compress";
import {
  saveDish,
  validateBasics,
  validateOptions,
  type DishDraft,
  type OptionDraft,
} from "../lib/menu-editor";
import { Modal } from "./Modal";

const money = (value: number) => `UGX ${value.toLocaleString("en-UG")}`;
const field =
  "w-full min-h-12 rounded-2xl border border-[var(--border-faint)] px-3 py-3 text-sm outline-none focus:border-gold";
const key = () => crypto.randomUUID();
const optionDrafts = (item: MenuItem | null): OptionDraft[] =>
  item?.options.map((option) => ({
    key: option.id,
    name: option.name,
    required: !!option.required,
    multiSelect: !!option.multi_select,
    choices: option.choices.map((choice) => ({
      key: choice.id,
      name: choice.name,
      priceDelta: String(choice.price_delta),
    })),
  })) ?? [];

export function MenuItemEditor({
  item,
  categoryId,
  categories,
  onClose,
  onSaved,
  onCategoryCreated,
}: {
  item: MenuItem | null;
  categoryId: string | null;
  categories: MenuCategory[];
  onClose: () => void;
  onSaved: (another: boolean, categoryId: string | null) => void;
  onCategoryCreated: (category: MenuCategory) => void;
}) {
  const initial: DishDraft = {
    name: item?.name ?? "",
    description: item?.description ?? "",
    price: item ? String(item.price) : "",
    categoryId: item?.category_id ?? categoryId ?? "",
    prepTime:
      item?.prep_time_minutes != null ? String(item.prep_time_minutes) : "",
    badge: item?.badge ?? "",
    available: item ? !!item.available : true,
  };
  const baseline = useRef(
    JSON.stringify({ draft: initial, options: optionDrafts(item) }),
  );
  const [draft, setDraft] = useState(initial);
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    optionDrafts(item),
  );
  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [newSection, setNewSection] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"close" | "delete" | null>(null);
  const checkpoint = useRef<{ id: string | null; unavailable?: boolean }>({
    id: item?.id ?? null,
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const editorBody = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const busy = !!stage || processingPhoto || addingSection;
  const dirty =
    !!photo || baseline.current !== JSON.stringify({ draft, options });
  const patch = (values: Partial<DishDraft>) => {
    setDraft((previous) => ({ ...previous, ...values }));
    setError(null);
  };

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setPhotoUrl(null);
    if (photo) {
      url = URL.createObjectURL(photo);
      setPhotoUrl(url);
    } else if (item?.photo_key)
      api
        .menuItemPhotoBlob(item.id)
        .then((blob) => {
          if (!cancelled && blob.type.startsWith("image/")) {
            url = URL.createObjectURL(blob);
            setPhotoUrl(url);
          }
        })
        .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo, item?.id, item?.photo_key]);

  function requestClose() {
    if (!busy)
      dirty || checkpoint.current.unavailable ? setConfirm("close") : onClose();
  }
  useEffect(() => {
    editorBody.current?.parentElement?.scrollTo({ top: 0 });
  }, [step]);
  async function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProcessingPhoto(true);
    setError(null);
    try {
      if (!file.type.startsWith("image/"))
        throw new Error("Choose an image for your dish.");
      const compressed = await compressImage(file);
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(compressed.type) ||
        compressed.size > 4 * 1024 * 1024
      )
        throw new Error("Choose a JPG, PNG or WebP photo under 4 MB.");
      setPhoto(compressed);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setProcessingPhoto(false);
    }
  }
  async function addSection() {
    if (!sectionName.trim() || addingSection) return;
    setAddingSection(true);
    setError(null);
    try {
      const existing = categories.find(
        (category) =>
          category.name.toLowerCase() === sectionName.trim().toLowerCase(),
      );
      const category =
        existing ??
        (await api.createMenuCategory({ name: sectionName.trim() })).category;
      if (!existing) onCategoryCreated(category);
      patch({ categoryId: category.id });
      setNewSection(false);
      setSectionName("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAddingSection(false);
    }
  }
  function addGroup(kind: "size" | "extras" | "custom") {
    setOptions((previous) => [
      ...previous,
      {
        key: key(),
        name: kind === "size" ? "Size" : kind === "extras" ? "Extras" : "",
        required: kind === "size",
        multiSelect: kind === "extras",
        choices:
          kind === "size"
            ? ["Regular", "Large"].map((name) => ({
                key: key(),
                name,
                priceDelta: "0",
              }))
            : [{ key: key(), name: "", priceDelta: "0" }],
      },
    ]);
    setError(null);
  }
  const changeOption = (id: string, values: Partial<OptionDraft>) =>
    setOptions((previous) =>
      previous.map((option) =>
        option.key === id ? { ...option, ...values } : option,
      ),
    );
  function next() {
    const invalid =
      validateBasics(draft) ?? (step === 1 ? validateOptions(options) : null);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setStep((previous) => previous + 1);
  }
  async function save(another: boolean) {
    if (saving.current || busy) return;
    saving.current = true;
    setError(null);
    try {
      await saveDish(api, checkpoint.current, draft, options, photo, setStage);
      onSaved(another, draft.categoryId || null);
    } catch (err) {
      setError(
        `${errorMessage(err)}${checkpoint.current.unavailable ? " This dish is saved as unavailable. Retry to finish saving it." : ""}`,
      );
    } finally {
      saving.current = false;
      setStage("");
    }
  }
  async function remove() {
    if (!item || saving.current) return;
    saving.current = true;
    setStage("Deleting");
    setError(null);
    try {
      await api.deleteMenuItem(item.id);
      onSaved(false, null);
    } catch (err) {
      setError(errorMessage(err));
      setConfirm(null);
    } finally {
      saving.current = false;
      setStage("");
    }
  }

  return (
    <Modal title={item ? "Edit dish" : "Add a dish"} onClose={requestClose}>
      <div ref={editorBody} className="space-y-5 pb-2">
        <nav
          aria-label="Dish creation steps"
          className="grid grid-cols-3 gap-2"
        >
          {["The dish", "Choices", "Preview"].map((label, index) => (
            <button
              type="button"
              key={label}
              disabled={busy || index > step}
              onClick={() => {
                setStep(index);
                setError(null);
              }}
              aria-current={step === index ? "step" : undefined}
              className={`flex items-center gap-2 rounded-xl p-2 text-xs font-bold ${step === index ? "bg-gold/15 text-ink" : "text-ink-500"}`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border-faint)]">
                {index < step ? <Check size={14} /> : index + 1}
              </span>
              {label}
            </button>
          ))}
        </nav>
        <fieldset
          disabled={busy}
          className="min-w-0 space-y-4 disabled:opacity-70"
        >
          {step === 0 && (
            <>
              <div>
                <h3 className="text-xl font-bold">
                  Start with the essentials.
                </h3>
                <p className="mt-1 text-sm text-ink-500">
                  A name and price are all you need to begin.
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex min-h-28 w-full items-center gap-4 overflow-hidden rounded-2xl border border-dashed border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3 text-left"
              >
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt="Your dish preview"
                    className="h-24 w-24 rounded-xl object-cover"
                  />
                ) : (
                  <Camera size={30} className="m-5 shrink-0 text-gold" />
                )}
                <span>
                  <span className="block font-bold">
                    {processingPhoto
                      ? "Preparing photo…"
                      : photoUrl
                        ? "Change photo"
                        : "Add a dish photo"}
                  </span>
                  <span className="mt-1 block text-xs text-ink-500">
                    Optional · choose a photo now, upload when you save.
                  </span>
                </span>
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={choosePhoto}
                className="hidden"
                aria-label="Dish photo"
              />
              <input
                aria-label="Dish name"
                maxLength={120}
                placeholder="Dish name · e.g. Chicken luwombo"
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value })}
                className={field}
              />
              <div className="field-box flex min-h-12 items-center gap-2 rounded-2xl border border-[var(--border-faint)] px-3">
                <span className="text-xs font-bold text-ink-500">UGX</span>
                <input
                  aria-label="Price in UGX"
                  inputMode="numeric"
                  placeholder="Price · e.g. 15000"
                  value={draft.price}
                  onChange={(event) =>
                    patch({ price: event.target.value.replace(/[^\d]/g, "") })
                  }
                  className="min-w-0 flex-1 outline-none"
                />
              </div>
              <Select
                aria-label="Menu section"
                sizing="stretch"
                value={draft.categoryId}
                onValueChange={(categoryId) => patch({ categoryId })}
                className={field}
              >
                <option value="">No section yet</option>
                {categories.map((category) => (
                  <option value={category.id} key={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
              {!newSection ? (
                <button
                  type="button"
                  onClick={() => setNewSection(true)}
                  className="flex min-h-11 items-center gap-2 text-sm font-bold text-gold"
                >
                  <Plus size={16} />
                  Create a section
                </button>
              ) : (
                <div className="space-y-2 rounded-2xl border border-[var(--border-faint)] p-3">
                  <input
                    aria-label="New section name"
                    maxLength={120}
                    placeholder="Section name · e.g. Main dishes"
                    className={field}
                    value={sectionName}
                    onChange={(event) => setSectionName(event.target.value)}
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={addSection}
                      disabled={!sectionName.trim()}
                      className="min-h-11 rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-50"
                    >
                      Add section
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewSection(false)}
                      className="text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <textarea
                aria-label="Dish description"
                placeholder="What makes this dish special? (optional)"
                value={draft.description}
                maxLength={2000}
                onChange={(event) => patch({ description: event.target.value })}
                rows={2}
                className={field}
              />
              <details className="rounded-2xl border border-[var(--border-faint)] p-3">
                <summary className="cursor-pointer text-sm font-bold">
                  Preparation time & badge
                </summary>
                <div className="mt-3 space-y-3">
                  <input
                    aria-label="Preparation time in minutes"
                    inputMode="numeric"
                    placeholder="Preparation time in minutes (optional)"
                    value={draft.prepTime}
                    onChange={(event) =>
                      patch({
                        prepTime: event.target.value.replace(/[^\d]/g, ""),
                      })
                    }
                    className={field}
                  />
                  <Select
                    aria-label="Dish badge"
                    sizing="stretch"
                    value={draft.badge}
                    onValueChange={(badge) =>
                      patch({ badge: badge as MenuItemBadge | "" })
                    }
                    className={field}
                  >
                    <option value="">No badge</option>
                    <option value="new">New</option>
                    <option value="trending">Trending</option>
                    <option value="sale">Sale</option>
                  </Select>
                </div>
              </details>
            </>
          )}
          {step === 1 && (
            <>
              <div>
                <h3 className="text-xl font-bold">Let customers choose.</h3>
                <p className="mt-1 text-sm text-ink-500">
                  Add sizes, sides or extras. You can skip this step.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["size", "extras", "custom"] as const).map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    disabled={options.length >= 10}
                    onClick={() => addGroup(kind)}
                    className="min-h-11 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold"
                  >
                    +{" "}
                    {kind === "size"
                      ? "Sizes"
                      : kind === "extras"
                        ? "Extras"
                        : "Custom group"}
                  </button>
                ))}
              </div>
              {!options.length && (
                <p className="rounded-2xl bg-[rgb(var(--surface-card))] p-4 text-sm text-ink-500">
                  One dish, one price? Continue to preview.
                </p>
              )}
              {options.map((option, index) => (
                <section
                  key={option.key}
                  className="space-y-3 rounded-2xl border border-[var(--border-faint)] p-3"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase text-ink-500">
                      Choice group {index + 1}
                    </h4>
                    <button
                      type="button"
                      aria-label={`Remove choice group ${index + 1}`}
                      onClick={() =>
                        setOptions((previous) =>
                          previous.filter((entry) => entry.key !== option.key),
                        )
                      }
                      className="flex h-11 w-11 items-center justify-center text-ink-500"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                  <input
                    aria-label={`Choice group ${index + 1} name`}
                    maxLength={80}
                    placeholder="Group name · e.g. Choose a side"
                    className={field}
                    value={option.name}
                    onChange={(event) =>
                      changeOption(option.key, { name: event.target.value })
                    }
                  />
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={option.required}
                        onChange={(event) =>
                          changeOption(option.key, {
                            required: event.target.checked,
                          })
                        }
                        className="accent-gold"
                      />
                      Must choose
                    </label>
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={option.multiSelect}
                        onChange={(event) =>
                          changeOption(option.key, {
                            multiSelect: event.target.checked,
                          })
                        }
                        className="accent-gold"
                      />
                      Allow several
                    </label>
                  </div>
                  <p className="text-xs text-ink-500">
                    Extra price is added to the dish price. Use 0 for no extra
                    charge.
                  </p>
                  {option.choices.map((choice, choiceIndex) => (
                    <div key={choice.key} className="flex items-center gap-2">
                      <input
                        aria-label={`Group ${index + 1} choice ${choiceIndex + 1} name`}
                        maxLength={80}
                        placeholder="Choice name"
                        value={choice.name}
                        onChange={(event) =>
                          changeOption(option.key, {
                            choices: option.choices.map((entry) =>
                              entry.key === choice.key
                                ? { ...entry, name: event.target.value }
                                : entry,
                            ),
                          })
                        }
                        className={`${field} min-w-0 flex-1`}
                      />
                      <input
                        aria-label={`Group ${index + 1} choice ${choiceIndex + 1} extra price in UGX`}
                        inputMode="numeric"
                        placeholder="Extra UGX"
                        value={choice.priceDelta}
                        onChange={(event) =>
                          changeOption(option.key, {
                            choices: option.choices.map((entry) =>
                              entry.key === choice.key
                                ? {
                                    ...entry,
                                    priceDelta: event.target.value.replace(
                                      /[^\d]/g,
                                      "",
                                    ),
                                  }
                                : entry,
                            ),
                          })
                        }
                        className={`${field} !w-24 shrink-0`}
                      />
                      <button
                        type="button"
                        aria-label={`Remove group ${index + 1} choice ${choiceIndex + 1}`}
                        onClick={() =>
                          changeOption(option.key, {
                            choices: option.choices.filter(
                              (entry) => entry.key !== choice.key,
                            ),
                          })
                        }
                        className="flex h-11 w-8 shrink-0 items-center justify-center text-ink-500"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={option.choices.length >= 30}
                    onClick={() =>
                      changeOption(option.key, {
                        choices: [
                          ...option.choices,
                          { key: key(), name: "", priceDelta: "0" },
                        ],
                      })
                    }
                    className="min-h-11 text-sm font-bold text-gold"
                  >
                    + Add choice
                  </button>
                </section>
              ))}
            </>
          )}
          {step === 2 && (
            <>
              <div>
                <h3 className="text-xl font-bold">Ready for your menu?</h3>
                <p className="mt-1 text-sm text-ink-500">
                  Check how your dish will look before saving.
                </p>
              </div>
              <article className="overflow-hidden rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))]">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt={draft.name}
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : (
                  <div className="flex h-24 items-center justify-center gap-2 text-sm text-ink-500">
                    <Camera size={22} />
                    Photo can be added later
                  </div>
                )}
                <div className="space-y-2 p-4">
                  <p className="text-xs text-ink-500">
                    {categories.find(
                      (category) => category.id === draft.categoryId,
                    )?.name ?? "No section"}
                    {draft.badge ? ` · ${draft.badge}` : ""}
                  </p>
                  <h4 className="text-xl font-bold">{draft.name}</h4>
                  {draft.description && (
                    <p className="text-sm text-ink-500">{draft.description}</p>
                  )}
                  <p className="font-bold">{money(Number(draft.price))}</p>
                  {draft.prepTime && (
                    <p className="text-xs text-ink-500">
                      About {draft.prepTime} minutes to prepare
                    </p>
                  )}
                  {options.map((option) => (
                    <div
                      key={option.key}
                      className="border-t border-[var(--border-faint)] pt-2 text-sm"
                    >
                      <p className="font-bold">
                        {option.name}{" "}
                        <span className="text-xs font-normal text-ink-500">
                          {option.required ? "Required" : "Optional"} ·{" "}
                          {option.multiSelect ? "Choose several" : "Choose one"}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-ink-500">
                        {option.choices
                          .map(
                            (choice) =>
                              `${choice.name}${Number(choice.priceDelta) ? ` (+${money(Number(choice.priceDelta))})` : ""}`,
                          )
                          .join(" · ")}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
              <label className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-[var(--border-faint)] p-3">
                <span>
                  <span className="block text-sm font-bold">
                    Available to order
                  </span>
                  <span className="block text-xs text-ink-500">
                    Turn off when this dish is not ready to serve.
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-gold"
                  checked={draft.available}
                  onChange={(event) =>
                    patch({ available: event.target.checked })
                  }
                />
              </label>
            </>
          )}
        </fieldset>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-[var(--border-faint)] p-3 text-sm"
          >
            {error}
          </p>
        )}
        {stage && (
          <p
            role="status"
            aria-live="polite"
            className="text-sm font-bold text-ink-500"
          >
            {stage}…
          </p>
        )}
        {confirm ? (
          <div className="space-y-3 rounded-2xl border border-[var(--border-faint)] p-4">
            <p className="font-bold">
              {confirm === "delete"
                ? "Delete this dish?"
                : checkpoint.current.unavailable
                  ? "Leave this unfinished dish?"
                  : "Discard your unsaved changes?"}
            </p>
            <p className="text-sm text-ink-500">
              {confirm === "delete"
                ? "This removes the dish and its choices from your menu."
                : checkpoint.current.unavailable
                  ? "It is saved as unavailable. You can open it from your menu to finish."
                  : "Keep editing to finish your dish."}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirm(null)}
                className="min-h-11 flex-1 rounded-full border border-[var(--border-faint)] text-sm font-bold"
              >
                Keep editing
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={confirm === "delete" ? remove : onClose}
                className="min-h-11 flex-1 rounded-full bg-gold text-sm font-bold text-ink-gold"
              >
                {confirm === "delete" ? "Delete dish" : "Leave editor"}
              </button>
            </div>
          </div>
        ) : (
          <div className="sticky bottom-0 space-y-2 bg-cream py-2">
            <div className="flex gap-2">
              {step > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setStep((previous) => previous - 1);
                    setError(null);
                  }}
                  aria-label="Previous step"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border-faint)]"
                >
                  <ChevronLeft size={20} />
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={step < 2 ? next : () => save(false)}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-50"
              >
                {busy
                  ? "Please wait…"
                  : step === 0
                    ? "Next: choices"
                    : step === 1
                      ? "Preview dish"
                      : item
                        ? "Save changes"
                        : "Save dish"}
                {step < 2 && <ChevronRight size={18} />}
              </button>
            </div>
            {step === 2 && !item && (
              <button
                type="button"
                disabled={busy}
                onClick={() => save(true)}
                className="min-h-11 w-full text-sm font-bold text-gold"
              >
                Save & add another dish
              </button>
            )}
            {item && step === 2 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirm("delete")}
                className="min-h-11 w-full text-sm text-ink-500"
              >
                Delete dish
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
