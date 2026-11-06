"use client";

import { useParams } from "next/navigation";
import { ChatLauncher } from "../../../../components/chat/ChatLauncher";

/** A direct link (a notification) to a school conversation opens it in the chat drawer. */
export default function SchoolMessagesPage() {
  const { schoolId } = useParams<{ schoolId: string }>();
  return <ChatLauncher layer={{ type: "school", id: schoolId }} underlay="/learn" />;
}
