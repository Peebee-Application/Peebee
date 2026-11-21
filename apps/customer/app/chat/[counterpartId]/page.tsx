"use client";

import { useParams } from "next/navigation";
import { ChatLauncher } from "../../../components/chat/ChatLauncher";

/** A direct link to a conversation opens it in the chat drawer. */
export default function ChatThreadPage() {
  const { counterpartId } = useParams<{ counterpartId: string }>();
  return <ChatLauncher layer={counterpartId === "peebee" ? { type: "system" } : { type: "rider", id: counterpartId }} underlay="/" />;
}
