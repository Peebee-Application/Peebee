"use client";

import Link from "next/link";
import { CourseCard } from "../../components/CourseCard";
import { Message, Screen } from "../../components/Screen";
import { tvApi } from "../../lib/api";
import { useAutoFocus } from "../../lib/dpad";
import { useLoad } from "../../lib/useLoad";

/** The courses of the account this TV is linked to. */
export default function MyCoursesPage() {
  const { data, error, loading } = useLoad((secret) => tvApi.enrollments(secret), []);
  const courses = data?.enrollments ?? [];
  useAutoFocus(!loading);

  return (
    <Screen title="My courses" kicker="Peebee Learn">
      {loading && <Message>Loading your courses…</Message>}
      {error && <Message tone="error">{error.message}</Message>}
      {!loading && !error && courses.length === 0 && (
        <div className="flex flex-col items-start gap-[1.2rem]">
          <Message>No courses yet. Browse to find one.</Message>
          <Link href="/browse" data-focusable className="rounded-full bg-gold px-[1.8rem] py-[0.7rem] text-[1.3rem] font-bold text-ink-gold focus:outline-none">
            Browse courses
          </Link>
        </div>
      )}
      {courses.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-[1.3rem]">
          {courses.map((c) => (
            <li key={c.id}>
              <CourseCard id={c.courseId} href={`/course/${c.courseId}`} title={c.title} subtitle={c.schoolName} progress={c.progressPercent} />
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
