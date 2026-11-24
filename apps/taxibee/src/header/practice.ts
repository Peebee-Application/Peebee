export * from "@peebee/shared";

// Taxibee has its own isolated practice entry point.
export function isPracticeMode() { return new URLSearchParams(location.search).get("preview") === "1"; }
export async function launchPractice(_role: string) { return "/?preview=1"; }
