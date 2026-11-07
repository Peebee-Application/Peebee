"use client";
import { LearningMessages } from "@peebee/shared/learning-messages";
import { api } from "../../../lib/api";
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-32 pt-5">
      <LearningMessages api={api} />
    </div>
  );
}
