"use client";

import { startPracticeMode } from "@peebee/shared";
import { useEffect } from "react";

export default function PracticeEntryPage() {
  useEffect(() => { window.location.replace(startPracticeMode("customer")); }, []);
  return <p className="p-5 text-sm text-ink-500">Opening the real customer app with safe practice data…</p>;
}
