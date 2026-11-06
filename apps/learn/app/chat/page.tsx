"use client";

import { useState } from "react";
import {
  MessageSquare,
  Search,
  Send,
  Paperclip,
  Mic,
  MicOff,
  Play,
  Pause,
  ShieldCheck,
  CheckCheck,
  Check,
  Clock,
  ThumbsUp,
  HelpCircle,
  FileText,
  Video,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import {
  DEMO_TUTOR_CONTACTS,
  DEMO_LIVE_CHAT_MESSAGES,
  type TutorContact,
  type LiveChatMessage,
} from "@peebee/shared";
import Link from "next/link";

export default function TutorChatPage() {
  const [selectedTutor, setSelectedTutor] = useState<TutorContact>(DEMO_TUTOR_CONTACTS[0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [isQuestion, setIsQuestion] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  // Local messages per tutor
  const [messages, setMessages] = useState<LiveChatMessage[]>([
    {
      id: "msg_tutor_1",
      senderId: "tutor_ken",
      senderName: "Dr. Kenneth Ochieng",
      senderRole: "tutor",
      text: "Hello Denis! I reviewed your notes on the mobile money float escrow model. Great questions regarding transaction idempotency.",
      timestamp: "10:14 AM",
    },
    {
      id: "msg_student_1",
      senderId: "part_denis",
      senderName: "Denis Kigozi",
      senderRole: "student",
      text: "Thank you Dr. Kenneth. Could you clarify how the telecom reversal webhook handles cases where the user's phone is switched off during callback?",
      timestamp: "10:16 AM",
      isQuestion: true,
      upvotes: 2,
    },
    {
      id: "msg_tutor_voice",
      senderId: "tutor_ken",
      senderName: "Dr. Kenneth Ochieng",
      senderRole: "tutor",
      text: "Here is a quick voice note explaining the store-and-forward queue mechanism.",
      timestamp: "10:18 AM",
      isVoiceNote: true,
      voiceDurationSecs: 24,
    },
    {
      id: "msg_tutor_attach",
      senderId: "tutor_ken",
      senderName: "Dr. Kenneth Ochieng",
      senderRole: "tutor",
      text: "Also review this architectural diagram before today's live lecture.",
      timestamp: "10:20 AM",
      attachmentUrl: "/docs/reconciliation_spec_v2.pdf",
    },
  ]);

  const filteredTutors = DEMO_TUTOR_CONTACTS.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.subject.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;

    const newMsg: LiveChatMessage = {
      id: `msg_${Date.now()}`,
      senderId: "part_denis",
      senderName: "Denis Kigozi",
      senderRole: "student",
      text: chatInput.trim(),
      timestamp: "Just now",
      isQuestion,
      upvotes: 0,
    };

    setMessages((prev) => [...prev, newMsg]);
    setChatInput("");
    setIsQuestion(false);

    // Tutor simulated automated reply
    setTimeout(() => {
      const replyMsg: LiveChatMessage = {
        id: `msg_reply_${Date.now()}`,
        senderId: selectedTutor.id,
        senderName: selectedTutor.name,
        senderRole: "tutor",
        text: `Got your message, Denis! I am reviewing your question now. We will also touch on this during our next live session.`,
        timestamp: "Just now",
      };
      setMessages((prev) => [...prev, replyMsg]);
    }, 1500);
  };

  const handleSendSimulatedVoiceNote = () => {
    setIsRecordingVoice(false);
    const voiceMsg: LiveChatMessage = {
      id: `voice_${Date.now()}`,
      senderId: "part_denis",
      senderName: "Denis Kigozi",
      senderRole: "student",
      text: "Voice Note Recorded (0:18)",
      timestamp: "Just now",
      isVoiceNote: true,
      voiceDurationSecs: 18,
    };
    setMessages((prev) => [...prev, voiceMsg]);
  };

  return (
    <div className="space-y-4">
      {/* Page Title & Safeguarding Notice */}
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-black text-ink"><ShieldCheck className="h-7 w-7 text-gold" aria-hidden /> Students</h1>
        <p className="text-lg text-ink-500">Verified, safeguarded messaging.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left Column: Tutors List */}
        <div className="home-card p-3 space-y-3">
          <div className="field-box px-2.5 py-1.5">
            <Search className="mr-2 h-3.5 w-3.5 text-ink-500" />
            <input
              type="text"
              placeholder="Search tutors & subjects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-base text-ink placeholder:text-ink-500/50"
            />
          </div>

          <div className="space-y-1">
            {filteredTutors.map((tutor) => {
              const isSelected = selectedTutor.id === tutor.id;
              return (
                <button
                  key={tutor.id}
                  onClick={() => setSelectedTutor(tutor)}
                  className={`flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition ${
                    isSelected
                      ? "bg-gold/15 border border-gold/40"
                      : "hover:bg-[rgb(var(--surface-muted))] border border-transparent"
                  }`}
                >
                  <div className="relative shrink-0">
                    <img
                      src={tutor.avatarUrl}
                      alt={tutor.name}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                    {tutor.isOnline && (
                      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-cream bg-gold" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-base font-black text-ink">{tutor.name}</p>
                      <span className="text-sm text-ink-500">{tutor.lastMessageTime}</span>
                    </div>
                    <p className="truncate text-sm text-ink-500">{tutor.subject}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right 2 Columns: Chat Pane */}
        <div className="home-card md:col-span-2 flex flex-col h-[560px] p-0 overflow-hidden">
          {/* Active Tutor Header */}
          <div className="flex items-center justify-between border-b border-[var(--border-faint)] bg-cream/50 p-3.5 dark:bg-black/40">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={selectedTutor.avatarUrl}
                alt={selectedTutor.name}
                className="h-12 w-12 rounded-full object-cover shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-black text-ink">{selectedTutor.name}</h2>
                  <span className="rounded bg-gold/15 px-1.5 py-0.2 text-sm font-black text-gold capitalize">
                    {selectedTutor.stream}
                  </span>
                </div>
                <p className="truncate text-base text-ink-500">{selectedTutor.title}</p>
              </div>
            </div>

            <Link
              href="/classroom"
              className="flex items-center gap-1.5 rounded-xl bg-gold px-3 py-1.5 text-base font-black text-black shadow-sm transition hover:opacity-90"
            >
              <Video className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Join Live Class</span>
            </Link>
          </div>

          {/* Messages Thread */}
          <div className="flex-1 space-y-3 p-4 overflow-y-auto bg-cream-50/50 dark:bg-black/20">
            {messages.map((msg) => {
              const isMe = msg.senderRole === "student";
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                >
                  <div className="flex items-center gap-1.5 text-sm text-ink-500 mb-1">
                    <span className="font-bold">{msg.senderName}</span>
                    <span>•</span>
                    <span>{msg.timestamp}</span>
                  </div>

                  <div
                    className={`max-w-[85%] rounded-2xl p-3 text-base leading-relaxed ${
                      isMe
                        ? "bg-ink text-cream dark:bg-gold dark:text-black font-medium"
                        : "border border-[var(--border-faint)] bg-cream text-ink dark:bg-black/50"
                    }`}
                  >
                    {/* Question highlight */}
                    {msg.isQuestion && (
                      <div className="mb-1 flex items-center gap-1 text-sm font-black uppercase tracking-wider text-gold">
                        <HelpCircle className="h-3 w-3" />
                        <span>Question for Tutor</span>
                      </div>
                    )}

                    <p>{msg.text}</p>

                    {/* Simulated Voice Note Bubble */}
                    {msg.isVoiceNote && (
                      <div className="mt-2 flex items-center gap-3 rounded-xl bg-black/10 p-2 dark:bg-white/10">
                        <button
                          onClick={() =>
                            setPlayingVoiceId(playingVoiceId === msg.id ? null : msg.id)
                          }
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-gold text-black"
                        >
                          {playingVoiceId === msg.id ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5 ml-0.5" />
                          )}
                        </button>
                        <div className="flex-1">
                          <div className="flex items-center gap-1">
                            <span className="h-3 w-1 bg-gold rounded-full" />
                            <span className="h-5 w-1 bg-gold rounded-full" />
                            <span className="h-2 w-1 bg-gold rounded-full" />
                            <span className="h-4 w-1 bg-gold rounded-full" />
                            <span className="h-6 w-1 bg-gold rounded-full" />
                            <span className="h-3 w-1 bg-gold rounded-full" />
                            <span className="h-4 w-1 bg-gold rounded-full" />
                          </div>
                        </div>
                        <span className="font-mono text-sm font-bold">
                          0:{msg.voiceDurationSecs || 20}
                        </span>
                      </div>
                    )}

                    {/* Attachment preview */}
                    {msg.attachmentUrl && (
                      <div className="mt-2 flex items-center justify-between rounded-xl bg-black/10 p-2 text-sm font-bold dark:bg-white/10">
                        <span className="flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 text-gold" />
                          <span>reconciliation_spec_v2.pdf</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const blob = new Blob(
                              ["Peebee Learn Study Reference: reconciliation_spec_v2.pdf\nInstructor: Dr. Kenneth Ochieng\n"],
                              { type: "text/plain;charset=utf-8" }
                            );
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = "reconciliation_spec_v2.txt";
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="text-sm text-gold underline cursor-pointer"
                        >
                          Save Copy
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Chat Composer */}
          <div className="border-t border-[var(--border-faint)] bg-cream p-3 dark:bg-black-700 space-y-2">
            <div className="flex items-center justify-between text-base">
              <label className="flex items-center gap-1.5 cursor-pointer text-ink-500 text-sm">
                <input
                  type="checkbox"
                  checked={isQuestion}
                  onChange={(e) => setIsQuestion(e.target.checked)}
                  className="rounded border-[var(--border-faint)] text-gold focus:ring-0"
                />
                <span>Tag as Question for Tutor</span>
              </label>

              {isRecordingVoice ? (
                <div className="flex items-center gap-2 text-base font-bold text-gold">
                  <span className="h-2 w-2 rounded-full bg-gold animate-ping" />
                  <span>Recording voice note...</span>
                  <button
                    onClick={handleSendSimulatedVoiceNote}
                    className="rounded-lg bg-gold px-2 py-0.5 text-ink-gold font-semibold"
                  >
                    Done & Send
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsRecordingVoice(true)}
                  className="flex items-center gap-1 text-sm font-bold text-gold hover:underline"
                >
                  <Mic className="h-3.5 w-3.5" />
                  <span>Record Voice Note</span>
                </button>
              )}
            </div>

            <div className="field-box px-3 py-2">
              <button
                type="button"
                className="mr-2 text-ink-500 hover:text-gold"
                title="Attach Document or Homework Photo"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <input
                type="text"
                placeholder={`Ask ${selectedTutor.name.split(" ")[0]} a question or share homework...`}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                className="w-full text-base text-ink placeholder:text-ink-500/50"
              />

              <button
                onClick={handleSendMessage}
                disabled={!chatInput.trim()}
                className="ml-2 rounded-xl bg-gold px-3 py-1.5 text-base font-black text-black disabled:opacity-40 transition hover:opacity-90"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
