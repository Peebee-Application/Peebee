import assert from "node:assert/strict";
import test from "node:test";
import {
  saveDish,
  validateBasics,
  validateOptions,
  type DishDraft,
  type OptionDraft,
} from "./menu-editor";

const dish: DishDraft = {
  name: "Rice and stew",
  price: "18000",
  description: "",
  categoryId: "",
  prepTime: "",
  badge: "",
  available: true,
};
const options: OptionDraft[] = [
  {
    key: "size",
    name: "Size",
    required: true,
    multiSelect: false,
    choices: [{ key: "regular", name: "Regular", priceDelta: "0" }],
  },
];

test("reject incomplete basics and options before any persistence", async () => {
  assert.ok(validateBasics({ ...dish, price: "" }));
  assert.ok(validateBasics({ ...dish, prepTime: "241" }));
  assert.equal(validateBasics({ ...dish, price: "0" }), null);
  assert.ok(validateOptions([{ ...options[0], choices: [] }]));
  assert.ok(validateOptions([{ ...options[0], name: "a".repeat(81) }]));
  assert.ok(validateOptions(Array.from({ length: 11 }, () => options[0])));
  let called = false;
  const client: Parameters<typeof saveDish>[0] = {
    createMenuItem: async () => {
      called = true;
      return { item: { id: "dish" } };
    },
    updateMenuItem: async () => {},
    setMenuItemOptions: async () => {},
    uploadMenuItemPhoto: async () => {},
  };
  await assert.rejects(
    saveDish(
      client,
      { id: null },
      dish,
      [{ ...options[0], name: "" }],
      null,
      () => {},
    ),
  );
  assert.equal(called, false);
});

test("failed photo upload leaves dish unavailable; retry reuses acknowledged ID", async () => {
  const checkpoint: { id: string | null; unavailable?: boolean } = { id: null };
  let creates = 0,
    uploads = 0;
  const actions: string[] = [];
  const client: Parameters<typeof saveDish>[0] = {
    createMenuItem: async (input) => {
      creates++;
      assert.equal(input.available, false);
      actions.push("create");
      return { item: { id: "dish-1" } };
    },
    updateMenuItem: async (id, input) => {
      assert.equal(id, "dish-1");
      actions.push(input.available ? "available" : "unavailable");
    },
    setMenuItemOptions: async (id) => {
      assert.equal(id, "dish-1");
      actions.push("choices");
    },
    uploadMenuItemPhoto: async () => {
      uploads++;
      actions.push("photo");
      if (uploads === 1) throw new Error("Upload failed");
    },
  };
  await assert.rejects(
    saveDish(client, checkpoint, dish, options, new Blob(["photo"]), () => {}),
    /Upload failed/,
  );
  assert.equal(checkpoint.id, "dish-1");
  assert.equal(checkpoint.unavailable, true);
  assert.ok(!actions.includes("available"));
  await saveDish(
    client,
    checkpoint,
    dish,
    options,
    new Blob(["photo"]),
    () => {},
  );
  assert.equal(creates, 1);
  assert.equal(checkpoint.unavailable, false);
  assert.deepEqual(actions.slice(-4), [
    "unavailable",
    "choices",
    "photo",
    "available",
  ]);
});

test("editing can clear optional fields and keep a dish unavailable", async () => {
  const calls: object[] = [];
  const client: Parameters<typeof saveDish>[0] = {
    createMenuItem: async () => {
      throw new Error("Must not create when editing");
    },
    updateMenuItem: async (_id, input) => {
      calls.push(input);
    },
    setMenuItemOptions: async (_id, input) => {
      assert.deepEqual(input, []);
    },
    uploadMenuItemPhoto: async () => {
      throw new Error("No photo to upload");
    },
  };
  await saveDish(
    client,
    { id: "existing" },
    { ...dish, available: false },
    [],
    null,
    () => {},
  );
  assert.deepEqual(calls.at(-1), { available: false });
  assert.equal((calls[0] as { description: null }).description, null);
  assert.equal((calls[0] as { prepTimeMinutes: null }).prepTimeMinutes, null);
});
