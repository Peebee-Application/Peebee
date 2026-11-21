import assert from "node:assert/strict";
import test from "node:test";
import { contactInputError, firstContact } from "./wallet-contact.js";

test("wallet contact lookup rejects short, long, and badly shaped values", () => {
  assert.equal(contactInputError("ab"), "short");
  assert.equal(contactInputError("a".repeat(201)), "long");
  assert.equal(contactInputError("not an email"), "format");
  assert.equal(contactInputError("ada@peebee"), "format");
  assert.equal(contactInputError("0772000412"), null);
  assert.equal(contactInputError("+256 772 000 412"), null);
  assert.equal(contactInputError("ada@peebee.test"), null);
});

test("a phone contact uses the first number and keeps the email", () => {
  assert.deepEqual(
    firstContact({ name: [" Ada "], tel: ["0772000412", "0700111222"], email: ["ada@peebee.test"] }),
    { name: "Ada", phone: "0772000412", email: "ada@peebee.test" },
  );
  assert.equal(firstContact(undefined), null);
  assert.equal(firstContact({ tel: ["  "] }), null);
});
