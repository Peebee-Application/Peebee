/** How a getUserMedia failure is explained. Photo search itself stays the existing coming-soon result. */
export function cameraFailure(name: string): "denied" | "missing" | "unavailable" {
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError") return "missing";
  return "unavailable";
}

/** Framing tips, not catalogue results. Nothing here is a product match. */
export const CAMERA_HINTS = [
  { id: "label", title: "Product label", body: "Fill the frame with the name." },
  { id: "shelf", title: "A shelf", body: "One item at a time." },
  { id: "package", title: "A package", body: "Include the price if it is printed." },
] as const;
