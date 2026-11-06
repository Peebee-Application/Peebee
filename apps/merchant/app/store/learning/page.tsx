"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LearningCreator } from "@peebee/shared/learning-creator";
import { api } from "../../../lib/api";
function Create() {
  const params = useSearchParams();
  return params.get("store") ? (
    <LearningCreator
      api={api}
      storeId={params.get("store")!}
      initialCourseId={params.get("course") || undefined}
    />
  ) : (
    <p>
      Open course authoring from the selected business's LMS & Learn Sync tab.
    </p>
  );
}
export default function Page() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-32 pt-5">
      <Suspense fallback={<p>Opening business learning workspace…</p>}>
        <Create />
      </Suspense>
    </main>
  );
}
