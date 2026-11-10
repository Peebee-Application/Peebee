import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@peebee/shared";
import { classifyAuthError } from "./auth-notice";

test("a wrong password keeps a plain message and does not look like a lockout", () => {
  const notice = classifyAuthError(new ApiError(401, "invalid_credentials", "invalid_credentials"));
  assert.equal(notice.tone, "error");
  assert.match(notice.message, /Wrong phone, email or password/);
});

test("lockout, offline and Google failures each have their own notice", () => {
  const lock = classifyAuthError(new ApiError(429, "rate_limited", "Too many failed attempts for this account. Please try again shortly."));
  assert.equal(lock.tone, "lockout");
  assert.match(lock.message, /Too many failed attempts/);
  assert.equal(classifyAuthError(new TypeError("Failed to fetch")).tone, "offline");
  const google = classifyAuthError(new ApiError(401, "invalid_google_token", "Google sign-in failed. Please try again."));
  assert.equal(google.tone, "google");
  assert.match(google.message, /email or phone/);
  const rider = classifyAuthError(new ApiError(409, "role_mismatch", "This Google account is already registered as a rider. Please sign in from the rider app instead."));
  assert.equal(rider.tone, "google");
  assert.match(rider.message, /rider app/);
});
