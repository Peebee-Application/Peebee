"use client";

import { SchoolChat } from "@peebee/shared/school-chat";
import { useCallback, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useCalls } from "../../lib/calls-context";

/** A conversation with a school: a learner or parent writing to its teachers. It lives inside the chat drawer. */
export function SchoolChatView({ schoolId, onBack }: { schoolId: string; onBack: () => void }) {
  const { startCall } = useCalls();
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    const res = await api.schoolChat(schoolId);
    setOwner({ id: res.schoolOwnerId, name: res.schoolName });
    return res;
  }, [schoolId]);
  const send = useCallback((body: string) => api.sendSchoolChat(schoolId, body), [schoolId]);
  const markRead = useCallback(() => api.markSchoolChatRead(schoolId), [schoolId]);

  return (
    <SchoolChat
      me="customer"
      title={owner?.name ?? "School"}
      subtitle="School"
      onBack={onBack}
      load={load}
      send={send}
      markRead={markRead}
      onCall={owner ? () => startCall({ calleeId: owner.id, schoolId }) : undefined}
      errorMessage={errorMessage}
    />
  );
}
