import assert from "node:assert/strict";
import test from "node:test";
import { identifierInputMode, identifierIsValid, identifierKind, identifierLabel, maskContact } from "./account-id";

test("the identifier keyboard follows what has been typed", () => {
  assert.equal(identifierKind(""), "unknown");
  assert.equal(identifierKind("+256 70"), "phone");
  assert.equal(identifierInputMode("+256 70"), "tel");
  assert.equal(identifierKind("sharon@example.com"), "email");
  assert.equal(identifierInputMode("sharon"), "email");
  assert.equal(identifierInputMode("s"), "email");
  assert.equal(identifierLabel("+256700000001"), "Phone");
  assert.equal(identifierLabel("sharon@example.com"), "Email");
});

test("a phone needs 9 digits and an email needs a domain", () => {
  assert.equal(identifierIsValid("+256 70"), false);
  assert.equal(identifierIsValid("+256 700 000 001"), true);
  assert.equal(identifierIsValid("sharon@example"), false);
  assert.equal(identifierIsValid("sharon@example.com"), true);
  assert.equal(identifierIsValid("not an id"), false);
});

test("a contact is masked without hiding which inbox or number it is", () => {
  assert.equal(maskContact("sharon@example.com"), "s*****@example.com");
  assert.equal(maskContact("s@example.com"), "s****@example.com");
  assert.equal(maskContact("+256700000001").endsWith("01"), true);
});
