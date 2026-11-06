"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LearningCreator } from "@peebee/shared/learning-creator";
import { api } from "../../../lib/api";
function Create() {
  const params = useSearchParams();
  return (
    <LearningCreator
      api={api}
      initialCourseId={params.get("course") || undefined}
      reviewOnly={params.get("review") === "1"}
      studyBase={
        typeof window !== "undefined"
          ? `${window.location.origin}/learn/study`
          : "/learn/study"
      }
    />
  );
}
export default function Page() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-32 pt-5">
      <Suspense fallback={<p>Opening learning workspace…</p>}>
        <Create />
      </Suspense>
    </div>
  );
}
