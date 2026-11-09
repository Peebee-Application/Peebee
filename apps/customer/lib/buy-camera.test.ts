import assert from "node:assert/strict";
import test from "node:test";
import { CAMERA_HINTS, cameraFailure } from "./buy-camera";

test("camera permission and hardware failures stay distinct", () => {
  assert.equal(cameraFailure("NotAllowedError"), "denied");
  assert.equal(cameraFailure("SecurityError"), "denied");
  assert.equal(cameraFailure("NotFoundError"), "missing");
  assert.equal(cameraFailure("NotReadableError"), "unavailable");
});

test("camera hints are framing tips, not product names from a catalogue", () => {
  assert.equal(CAMERA_HINTS.length, 3);
  assert.equal(CAMERA_HINTS.every((hint) => hint.title.length > 0 && hint.body.length > 0), true);
});
