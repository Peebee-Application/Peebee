"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LearningCreator } from "@peebee/shared/learning-creator";
import { api } from "../../lib/api";
function Create() {
  const params = useSearchParams();
  return (
    <LearningCreator
      api={api}
      initialClassId={params.get("class") || undefined}
      initialCourseId={params.get("course") || undefined}
      reviewOnly={params.get("review") === "1"}
    />
  );
}
export default function Page() {
  return (
    <Suspense fallback={<p>Opening course authoring…</p>}>
      <Create />
    </Suspense>
  );
}
