import type { MenuItemBadge } from "@peebee/shared";

export type ChoiceDraft = { key: string; name: string; priceDelta: string };
export type OptionDraft = {
  key: string;
  name: string;
  required: boolean;
  multiSelect: boolean;
  choices: ChoiceDraft[];
};
export type DishDraft = {
  name: string;
  description: string;
  price: string;
  categoryId: string;
  prepTime: string;
  badge: MenuItemBadge | "";
  available: boolean;
};
export type OptionInput = {
  name: string;
  required: boolean;
  multiSelect: boolean;
  choices: { name: string; priceDelta: number }[];
};
type DishInput = {
  name: string;
  description: string | null;
  price: number;
  categoryId: string | null;
  prepTimeMinutes: number | null;
  badge: MenuItemBadge | null;
  available: boolean;
};
type SaveApi = {
  createMenuItem(
    input: Omit<DishInput, "description" | "prepTimeMinutes"> & {
      description?: string;
      prepTimeMinutes?: number;
    },
  ): Promise<{ item: { id: string } }>;
  updateMenuItem(id: string, input: Partial<DishInput>): Promise<unknown>;
  setMenuItemOptions(id: string, input: OptionInput[]): Promise<unknown>;
  uploadMenuItemPhoto(id: string, photo: Blob): Promise<unknown>;
};

export function validateBasics(draft: DishDraft): string | null {
  if (!draft.name.trim()) return "Give your dish a name.";
  if (draft.name.trim().length > 120)
    return "Keep the dish name under 121 characters.";
  if (
    !draft.price.trim() ||
    !Number.isSafeInteger(Number(draft.price)) ||
    Number(draft.price) < 0
  )
    return "Enter a whole-number price in UGX.";
  if (draft.description.length > 2000)
    return "Keep the description under 2,001 characters.";
  if (
    draft.prepTime &&
    (!Number.isInteger(Number(draft.prepTime)) ||
      Number(draft.prepTime) < 1 ||
      Number(draft.prepTime) > 240)
  )
    return "Preparation time must be between 1 and 240 minutes.";
  return null;
}

export function validateOptions(options: OptionDraft[]): string | null {
  if (options.length > 10) return "Use up to 10 choice groups per dish.";
  for (const option of options) {
    if (!option.name.trim())
      return "Name each choice group, or remove the group you do not need.";
    if (option.name.trim().length > 80)
      return "Keep choice group names under 81 characters.";
    if (option.choices.length > 30)
      return `Use up to 30 choices in ${option.name.trim()}.`;
    if (
      !option.choices.length ||
      option.choices.some((choice) => !choice.name.trim())
    )
      return `Add a name for every choice in ${option.name.trim()}.`;
    if (
      option.choices.some(
        (choice) =>
          choice.name.trim().length > 80 ||
          !Number.isSafeInteger(Number(choice.priceDelta)) ||
          Number(choice.priceDelta) < 0,
      )
    )
      return `Use choice names under 81 characters and whole-number extra prices in ${option.name.trim()}.`;
  }
  return null;
}

/** Preserve the acknowledged item ID if a later upload fails. Retrying updates
 * that row rather than creating another, and ordering is enabled only last. */
export async function saveDish(
  client: SaveApi,
  checkpoint: { id: string | null; unavailable?: boolean },
  draft: DishDraft,
  options: OptionDraft[],
  photo: Blob | null,
  progress: (stage: string) => void,
) {
  const invalid = validateBasics(draft) ?? validateOptions(options);
  if (invalid) throw new Error(invalid);
  const input: DishInput = {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    price: Number(draft.price),
    categoryId: draft.categoryId || null,
    prepTimeMinutes: draft.prepTime ? Number(draft.prepTime) : null,
    badge: draft.badge || null,
    available: false,
  };
  progress("Saving dish");
  if (checkpoint.id) await client.updateMenuItem(checkpoint.id, input);
  else {
    const created = await client.createMenuItem({
      ...input,
      description: input.description ?? undefined,
      prepTimeMinutes: input.prepTimeMinutes ?? undefined,
    });
    checkpoint.id = created.item.id;
  }
  checkpoint.unavailable = true;
  progress("Saving choices");
  await client.setMenuItemOptions(
    checkpoint.id,
    options.map((option) => ({
      name: option.name.trim(),
      required: option.required,
      multiSelect: option.multiSelect,
      choices: option.choices.map((choice) => ({
        name: choice.name.trim(),
        priceDelta: Number(choice.priceDelta),
      })),
    })),
  );
  if (photo) {
    progress("Uploading photo");
    await client.uploadMenuItemPhoto(checkpoint.id, photo);
  }
  progress("Finishing");
  await client.updateMenuItem(checkpoint.id, { available: draft.available });
  checkpoint.unavailable = false;
  return checkpoint.id;
}
