"use client";
import { Suspense } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { LearningStudy } from "@peebee/shared/learning-study";
import { api } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { rememberReturnTo } from "../../../../lib/return-to";
function Study() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>(),
    params = useSearchParams(),
    { user, ready } = useAuth();
  if (!ready) return <p>Opening course…</p>;
  return (
    <LearningStudy
      api={api}
      courseId={id}
      inviteToken={params.get("invite") || undefined}
      signedIn={!!user}
      onSignIn={() => {
        rememberReturnTo(window.location.pathname + window.location.search);
        router.push("/login");
      }}
    />
  );
}
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-32 pt-5">
      <Suspense fallback={<p>Opening course…</p>}>
        <Study />
      </Suspense>
    </div>
  );
}
