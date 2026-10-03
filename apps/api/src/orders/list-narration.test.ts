import assert from "node:assert/strict";
import test from "node:test";
import { buildLugandaListNarration } from "./list-narration.js";
import { translateListToLuganda } from "../speech/gemini.js";

type Call = { model: string; prompt: string };

/** A pretend Google: answers list requests (JSON array) and single-phrase requests. */
function fakeGoogle(opts: { listAnswer?: (n: number) => string } = {}) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const prompt: string = body.contents[0].parts[0].text;
    calls.push({ model: String(url).split("/models/")[1]?.split(":")[0] ?? "", prompt });
    const isList = body.generationConfig?.responseMimeType === "application/json";
    let text: string;
    if (isList) {
      const phrases = JSON.parse(prompt.slice(prompt.indexOf("["))) as string[];
      text = opts.listAnswer ? opts.listAnswer(phrases.length) : JSON.stringify(phrases.map((p) => `LUG(${p})`));
    } else {
      text = `LUG(${prompt.split("\n\n").pop()})`;
    }
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

const items = [
  { name: "tomatoes", quantity: 1, unit_price: 2000 },
  { name: "rice", quantity: 2, unit_price: 5000 },
  { name: "milk", quantity: 1, unit_price: null },
];

test("whole list: one request for the lot, item by item: one per item", async () => {
  process.env.GEMINI_API_KEY = "test-key-padding-padding-padding";
  const g = fakeGoogle();
  try {
    const whole = await buildLugandaListNarration(items, "whole_list");
    assert.equal(g.calls.length, 1, "the whole list in a single request");
    const perItem = await buildLugandaListNarration(items, "per_item");
    assert.equal(g.calls.length, 1 + 3, "three more, one per item");
    assert.equal(whole, perItem, "same narration either way");
    assert.match(whole, /LUG\(tomatoes\)/);
    assert.match(whole, /LUG\(2 rice\)/);
    assert.match(whole, /Omugatte gwonna/);
  } finally {
    g.restore();
  }
});

test("per item is the default", async () => {
  process.env.GEMINI_API_KEY = "test-key-padding-padding-padding";
  const g = fakeGoogle();
  try {
    await buildLugandaListNarration(items);
    assert.equal(g.calls.length, 3);
  } finally {
    g.restore();
  }
});

test("whole list falls back to item by item if Google's answer doesn't line up", async () => {
  process.env.GEMINI_API_KEY = "test-key-padding-padding-padding";
  for (const bad of [(n: number) => JSON.stringify(Array(n - 1).fill("x")), () => "not json at all", () => JSON.stringify(["a", "", "c"])]) {
    const g = fakeGoogle({ listAnswer: bad });
    try {
      const out = await buildLugandaListNarration(items, "whole_list");
      assert.equal(g.calls.length, 1 + 3, "one failed list request, then each item");
      assert.match(out, /LUG\(tomatoes\)/);
    } finally {
      g.restore();
    }
  }
});

test("a one-item list doesn't need the list request", async () => {
  process.env.GEMINI_API_KEY = "test-key-padding-padding-padding";
  const g = fakeGoogle();
  try {
    await buildLugandaListNarration([items[0]], "whole_list");
    assert.equal(g.calls.length, 1);
    assert.ok(!g.calls[0].prompt.includes("JSON array"));
  } finally {
    g.restore();
  }
});

test("list translation accepts a fenced JSON answer and rejects wrong-length ones", async () => {
  process.env.GEMINI_API_KEY = "test-key-padding-padding-padding";
  const fenced = fakeGoogle({ listAnswer: () => '```json\n["a","b"]\n```' });
  try {
    assert.deepEqual(await translateListToLuganda(["x", "y"]), ["a", "b"]);
    await assert.rejects(() => translateListToLuganda(["x", "y", "z"]), /did not return 3/);
  } finally {
    fenced.restore();
  }
});
