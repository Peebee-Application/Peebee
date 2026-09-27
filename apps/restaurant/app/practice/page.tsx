"use client";

import { startPracticeMode } from "@tuma/shared";
import { useEffect } from "react";

export default function PracticeEntryPage() {
  useEffect(() => { window.location.replace(startPracticeMode("restaurant")); }, []);
  return <p className="p-5 text-sm text-ink-500">Opening the real restaurant app with safe practice data…</p>;
}
