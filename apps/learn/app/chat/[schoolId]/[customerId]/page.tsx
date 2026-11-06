"use client";

import { SchoolChat } from "@peebee/shared/school-chat";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { useCalls } from "../../../../lib/calls-context";

/** One conversation with someone who wrote to the school. */
export default function StudentChatPage() {
  const { schoolId, customerId } = useParams<{ schoolId: string; customerId: string }>();
  const router = useRouter();
  const { startCall } = useCalls();
  const [names, setNames] = useState<{ person: string; school: string } | null>(null);

  const load = useCallback(async () => {
    const res = await api.studioSchoolChat(schoolId, customerId);
    setNames({ person: res.customerName ?? "Someone", school: res.schoolName });
    return res;
  }, [schoolId, customerId]);
  const send = useCallback((body: string) => api.replySchoolChat(schoolId, customerId, body), [schoolId, customerId]);
  const markRead = useCallback(() => api.markStudioSchoolChatRead(schoolId, customerId), [schoolId, customerId]);

  return (
    <SchoolChat
      me="school"
      title={names?.person ?? "Messages"}
      subtitle={names?.school}
      onBack={() => router.push("/chat")}
      load={load}
      send={send}
      markRead={markRead}
      onCall={() => startCall({ calleeId: customerId, schoolId })}
      errorMessage={errorMessage}
    />
  );
}
