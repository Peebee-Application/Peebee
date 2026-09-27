"use client";

import { startPracticeMode } from "@tuma/shared";
import { useEffect } from "react";

export default function PracticeEntryPage() {
  useEffect(() => { window.location.replace(startPracticeMode("rider")); }, []);
  return <p className="p-5 text-sm text-ink-500">Opening the real rider app with safe practice data…</p>;
}
