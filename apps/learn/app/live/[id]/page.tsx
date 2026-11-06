"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Share2,
  Hand,
  PenTool,
  MessageSquare,
  Users,
  PhoneOff,
  Maximize2,
  Minimize2,
  Radio,
  CheckCircle2,
  Sparkles,
  HelpCircle,
  ThumbsUp,
  Send,
  Eraser,
  Palette,
  RotateCcw,
  ChevronLeft,
  Search,
  Volume2,
} from "lucide-react";
import {
  DEMO_LIVE_MEETINGS,
  DEMO_LIVE_PARTICIPANTS,
  DEMO_LIVE_CHAT_MESSAGES,
  type EducationLiveMeeting,
  type LiveParticipant,
  type LiveChatMessage,
} from "@peebee/shared";

export default function LiveMeetingRoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = (params?.id as string) || "live_fintech_101";

  // Meeting lookup
  const initialMeeting =
    DEMO_LIVE_MEETINGS.find((m) => m.id === roomId || m.roomCode === roomId) ||
    DEMO_LIVE_MEETINGS[0];

  const [meeting, setMeeting] = useState<EducationLiveMeeting>(initialMeeting);
  const [participants, setParticipants] = useState<LiveParticipant[]>(DEMO_LIVE_PARTICIPANTS);
  const [messages, setMessages] = useState<LiveChatMessage[]>(DEMO_LIVE_CHAT_MESSAGES);

  // Local student controls
  const [isMuted, setIsMuted] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [hasHandRaised, setHasHandRaised] = useState(false);
  const [handRaiseNotice, setHandRaiseNotice] = useState<string | null>(null);

  // Active view & drawer
  const [activeView, setActiveView] = useState<"video" | "whiteboard" | "screen">("video");
  const [activeDrawer, setActiveDrawer] = useState<"none" | "chat" | "participants">("chat");
  const [chatFilter, setChatFilter] = useState<"all" | "questions">("all");
  const [chatInput, setChatInput] = useState("");
  const [isQuestionInput, setIsQuestionInput] = useState(false);
  const [participantSearch, setParticipantSearch] = useState("");

  // Elapsed timer
  const [elapsedSecs, setElapsedSecs] = useState(1452); // ~24 mins
  const [speakerHighlight, setSpeakerHighlight] = useState<string>("part_host");

  // Whiteboard drawing tools
  const [whiteboardTool, setWhiteboardTool] = useState<"pen" | "highlighter" | "eraser">("pen");
  const [whiteboardColor, setWhiteboardColor] = useState<string>("#C9A227"); // Peebee gold
  const [whiteboardSlideIndex, setWhiteboardSlideIndex] = useState(1);
  const [canvasStrokes, setCanvasStrokes] = useState<{ x: number; y: number; text?: string }[]>([]);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSecs((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Format timer string HH:MM:SS
  const formatTimer = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  };

  const handleToggleHand = () => {
    const nextState = !hasHandRaised;
    setHasHandRaised(nextState);

    // Update local participant state in roster
    setParticipants((prev) =>
      prev.map((p) =>
        p.id === "part_denis" ? { ...p, hasHandRaised: nextState } : p
      )
    );

    if (nextState) {
      setHandRaiseNotice("Hand raised! Host and TAs have been alerted.");
      setTimeout(() => setHandRaiseNotice(null), 4000);
    }
  };

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;

    const newMsg: LiveChatMessage = {
      id: `msg_${Date.now()}`,
      roomId: meeting.id,
      senderId: "part_denis",
      senderName: "Denis Kigozi (You)",
      senderRole: "student",
      text: chatInput.trim(),
      timestamp: "Just now",
      isQuestion: isQuestionInput,
      upvotes: 0,
    };

    setMessages((prev) => [...prev, newMsg]);
    setChatInput("");
    setIsQuestionInput(false);
  };

  const handleUpvoteMessage = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, upvotes: (m.upvotes || 0) + 1 } : m
      )
    );
  };

  const filteredMessages = messages.filter((m) => {
    if (chatFilter === "questions") return Boolean(m.isQuestion);
    return true;
  });

  const filteredParticipants = participants.filter((p) =>
    p.name.toLowerCase().includes(participantSearch.toLowerCase())
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-black text-white select-none">
      {/* 1. Meeting Top Bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-black-900/95 px-4 py-2.5 backdrop-blur z-20">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/live"
            className="flex items-center gap-1 rounded-xl bg-white/10 px-2.5 py-1 text-base font-bold text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Exit</span>
          </Link>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
              </span>
              <span className="rounded bg-red-500/20 px-1.5 py-0.2 text-sm font-black uppercase text-red-400">
                REC
              </span>
              <span className="font-mono text-base font-bold text-white/70">
                {formatTimer(elapsedSecs)}
              </span>
              <span className="hidden text-base text-white/40 sm:inline">•</span>
              <span className="hidden rounded bg-white/10 px-2 py-0.5 text-sm font-mono text-white/80 sm:inline">
                {meeting.roomCode}
              </span>
            </div>
            <h1 className="truncate text-base font-bold text-white sm:text-lg">
              {meeting.title}
            </h1>
          </div>
        </div>

        {/* View Switcher Pills */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setActiveView("video")}
            className={`rounded-xl px-2.5 py-1 text-base font-bold transition ${
              activeView === "video"
                ? "bg-gold text-black font-black"
                : "bg-white/10 text-white/70 hover:bg-white/15 hover:text-white"
            }`}
          >
            Video Grid
          </button>
          <button
            onClick={() => setActiveView("whiteboard")}
            className={`flex items-center gap-1 rounded-xl px-2.5 py-1 text-base font-bold transition ${
              activeView === "whiteboard"
                ? "bg-gold text-black font-black"
                : "bg-white/10 text-white/70 hover:bg-white/15 hover:text-white"
            }`}
          >
            <PenTool className="h-3 w-3" />
            <span>Whiteboard</span>
          </button>
          <button
            onClick={() => setActiveView("screen")}
            className={`hidden sm:flex items-center gap-1 rounded-xl px-2.5 py-1 text-base font-bold transition ${
              activeView === "screen"
                ? "bg-gold text-black font-black"
                : "bg-white/10 text-white/70 hover:bg-white/15 hover:text-white"
            }`}
          >
            <Share2 className="h-3 w-3" />
            <span>Screen</span>
          </button>
        </div>
      </header>

      {/* Hand Raise Notice Notification */}
      {handRaiseNotice && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-2xl bg-gold px-4 py-2 text-base font-black text-black shadow-lg animate-bounce">
          <Hand className="h-4 w-4" />
          <span>{handRaiseNotice}</span>
        </div>
      )}

      {/* 2. Main Meeting Stage Area */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Stage Viewport */}
        <div className="flex flex-1 flex-col p-2 sm:p-4 overflow-y-auto">
          {/* VIEW 1: Video Grid */}
          {activeView === "video" && (
            <div className="flex flex-1 flex-col gap-3">
              {/* Primary Active Speaker / Host Tile */}
              <div
                className={`live-video-tile relative flex-1 min-h-[220px] sm:min-h-[300px] flex items-center justify-center bg-zinc-900 ${
                  speakerHighlight === "part_host" ? "is-speaking" : ""
                }`}
              >
                {/* Host Video Stream Preview */}
                <img
                  src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=1200&q=80"
                  alt={meeting.hostTutorName}
                  className="h-full w-full object-cover opacity-90"
                />

                {/* Speaker Audio Waves Overlay */}
                <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-base font-bold backdrop-blur">
                  <Volume2 className="h-3.5 w-3.5 text-gold animate-pulse" />
                  <span className="text-sm text-white/90">Speaking</span>
                </div>

                {/* Host Info Label */}
                <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-xl bg-black/75 px-3 py-1.5 text-base font-bold backdrop-blur">
                  <span className="rounded bg-gold px-1.5 py-0.5 text-sm font-black text-black uppercase">
                    HOST
                  </span>
                  <span>{meeting.hostTutorName}</span>
                </div>
              </div>

              {/* Secondary Student Camera Tiles */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                {participants
                  .filter((p) => p.id !== "part_host")
                  .map((p) => {
                    const isSelf = p.id === "part_denis";
                    return (
                      <div
                        key={p.id}
                        className={`live-video-tile relative flex aspect-video items-center justify-center bg-zinc-800 ${
                          p.hasHandRaised ? "border-gold" : ""
                        }`}
                      >
                        {p.isVideoOn ? (
                          <img
                            src={p.avatarUrl}
                            alt={p.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1">
                            <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center font-bold text-lg">
                              {p.name.charAt(0)}
                            </div>
                            <span className="text-sm text-white/50">Camera Off</span>
                          </div>
                        )}

                        {/* Hand Raised Floating Badge */}
                        {p.hasHandRaised && (
                          <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-gold px-2 py-0.5 text-sm font-black text-black animate-pulse">
                            <Hand className="h-3 w-3" />
                            <span>Hand Raised</span>
                          </div>
                        )}

                        {/* Mute status badge */}
                        <div className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white/80">
                          {p.isMuted ? (
                            <MicOff className="h-3 w-3 text-red-400" />
                          ) : (
                            <Mic className="h-3 w-3 text-green-400" />
                          )}
                        </div>

                        {/* Name label */}
                        <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-lg bg-black/70 px-2 py-0.5 text-sm font-bold">
                          <span>{p.name}</span>
                          {isSelf && <span className="text-gold">(You)</span>}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* VIEW 2: Collaborative Whiteboard */}
          {activeView === "whiteboard" && (
            <div className="flex flex-1 flex-col rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden">
              {/* Whiteboard Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-zinc-900 px-4 py-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setWhiteboardTool("pen")}
                    className={`rounded-xl p-2 transition ${
                      whiteboardTool === "pen"
                        ? "bg-gold text-black"
                        : "text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                    title="Pen"
                  >
                    <PenTool className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setWhiteboardTool("eraser")}
                    className={`rounded-xl p-2 transition ${
                      whiteboardTool === "eraser"
                        ? "bg-gold text-black"
                        : "text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                    title="Eraser"
                  >
                    <Eraser className="h-4 w-4" />
                  </button>

                  <div className="h-5 w-px bg-white/20 mx-1" />

                  {/* Color pickers */}
                  <div className="flex items-center gap-1">
                    {[
                      { hex: "#C9A227", name: "Gold" },
                      { hex: "#3B82F6", name: "Blue" },
                      { hex: "#10B981", name: "Green" },
                      { hex: "#EF4444", name: "Red" },
                      { hex: "#FFFFFF", name: "White" },
                    ].map((c) => (
                      <button
                        key={c.hex}
                        onClick={() => setWhiteboardColor(c.hex)}
                        style={{ backgroundColor: c.hex }}
                        className={`h-5 w-5 rounded-full transition-transform ${
                          whiteboardColor === c.hex ? "scale-125 ring-2 ring-white" : ""
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {/* Slide Switcher */}
                <div className="flex items-center gap-2 text-base font-bold text-white/70">
                  <button
                    onClick={() => setWhiteboardSlideIndex((s) => Math.max(1, s - 1))}
                    className="rounded-lg bg-white/10 px-2 py-1 hover:bg-white/20"
                  >
                    ◀
                  </button>
                  <span>Slide {whiteboardSlideIndex} / 3</span>
                  <button
                    onClick={() => setWhiteboardSlideIndex((s) => Math.min(3, s + 1))}
                    className="rounded-lg bg-white/10 px-2 py-1 hover:bg-white/20"
                  >
                    ▶
                  </button>

                  <button
                    onClick={() => setCanvasStrokes([])}
                    className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-sm hover:bg-white/20"
                  >
                    <RotateCcw className="h-3 w-3" /> Clear
                  </button>
                </div>
              </div>

              {/* Whiteboard Interactive Canvas Area */}
              <div className="relative flex flex-1 items-center justify-center p-6 bg-zinc-900/60 overflow-hidden">
                {/* Pre-drawn Classroom Diagram */}
                <div className="max-w-xl w-full rounded-2xl border-2 border-dashed border-white/20 bg-black/60 p-6 text-center">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <span className="text-base font-black uppercase tracking-wider text-gold">
                      Tutor Board: Mobile Wallet Double-Entry Reconciliation
                    </span>
                    <span className="rounded bg-green-500/20 px-2 py-0.5 text-sm font-bold text-green-400">
                      Live Synced
                    </span>
                  </div>

                  <div className="mt-6 grid grid-cols-3 gap-3 text-base">
                    <div className="rounded-xl border border-gold/40 bg-gold/10 p-3">
                      <p className="font-black text-gold">Peebee Core Ledger</p>
                      <p className="mt-1 font-mono text-sm text-white/70">
                        DEBIT User Float<br />
                        CREDIT Escrow Account
                      </p>
                    </div>

                    <div className="flex flex-col items-center justify-center">
                      <span className="text-sm font-mono text-gold animate-pulse">
                        3-Way Handshake ➔
                      </span>
                      <div className="h-0.5 w-full bg-gold/50 my-1" />
                      <span className="text-sm text-white/50">Idempotency Key</span>
                    </div>

                    <div className="rounded-xl border border-gold/40 bg-gold/10 p-3">
                      <p className="font-black text-gold">Telecom Switch</p>
                      <p className="mt-1 font-mono text-sm text-white/70">
                        MTN / Airtel MoMo<br />
                        Instant SMS Push
                      </p>
                    </div>
                  </div>

                  {/* Tutor Note */}
                  <div className="mt-6 rounded-xl bg-white/5 p-3 text-left">
                    <div className="flex items-center gap-1.5 text-base font-bold text-gold">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Dr. Kenneth's Whiteboard Annotation:</span>
                    </div>
                    <p className="mt-1 text-base text-white/80">
                      &quot;Notice how network timeouts are isolated. If the telecom webhook fails, the reversal worker polls the transaction inquiry endpoint without double debiting.&quot;
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 3: Shared Screen */}
          {activeView === "screen" && (
            <div className="flex flex-1 flex-col rounded-2xl border border-white/10 bg-zinc-950 p-6 items-center justify-center">
              <div className="text-center max-w-md">
                <Share2 className="mx-auto h-12 w-12 text-gold animate-bounce" />
                <h3 className="mt-3 text-lg font-black text-white">
                  Dr. Kenneth is Sharing His Screen
                </h3>
                <p className="mt-1 text-base text-white/60">
                  Slide deck: &quot;Bank of Uganda National Payment Systems Regulatory Sandbox 2026&quot;
                </p>
                <button
                  onClick={() => setActiveView("whiteboard")}
                  className="mt-4 rounded-xl bg-gold px-4 py-2 text-base font-black text-black"
                >
                  Switch to Whiteboard View
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 3. Side Drawer: Live Chat or Participants */}
        {activeDrawer !== "none" && (
          <aside className="w-80 shrink-0 border-l border-white/10 bg-zinc-950 flex flex-col z-30">
            {/* Drawer Header Tabs */}
            <div className="flex items-center justify-between border-b border-white/10 bg-zinc-900 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveDrawer("chat")}
                  className={`text-base font-black px-2 py-1 rounded-lg transition ${
                    activeDrawer === "chat"
                      ? "bg-gold text-black"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  Live Chat ({messages.length})
                </button>
                <button
                  onClick={() => setActiveDrawer("participants")}
                  className={`text-base font-black px-2 py-1 rounded-lg transition ${
                    activeDrawer === "participants"
                      ? "bg-gold text-black"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  Roster ({participants.length})
                </button>
              </div>
              <button
                onClick={() => setActiveDrawer("none")}
                className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* DRAWER CONTENT A: Live Chat */}
            {activeDrawer === "chat" && (
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* Chat Sub-filter */}
                <div className="flex border-b border-white/10 p-2 gap-1 bg-zinc-900/50">
                  <button
                    onClick={() => setChatFilter("all")}
                    className={`flex-1 rounded-lg py-1 text-sm font-bold transition ${
                      chatFilter === "all" ? "bg-white/20 text-white" : "text-white/50 hover:text-white"
                    }`}
                  >
                    All Messages
                  </button>
                  <button
                    onClick={() => setChatFilter("questions")}
                    className={`flex-1 rounded-lg py-1 text-sm font-bold transition ${
                      chatFilter === "questions" ? "bg-gold text-black font-black" : "text-white/50 hover:text-white"
                    }`}
                  >
                    Questions & Q&A
                  </button>
                </div>

                {/* Messages Feed */}
                <div className="flex-1 space-y-3 p-3 overflow-y-auto">
                  {filteredMessages.map((msg) => {
                    const isTutor = msg.senderRole === "tutor";
                    return (
                      <div
                        key={msg.id}
                        className={`rounded-xl p-2.5 text-base ${
                          msg.isQuestion
                            ? "border border-gold/40 bg-gold/10"
                            : isTutor
                            ? "border border-gold/30 bg-gold/10"
                            : "bg-white/5"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`font-bold ${
                              isTutor ? "text-white font-black" : msg.isQuestion ? "text-gold" : "text-white/90"
                            }`}
                          >
                            {msg.senderName}
                          </span>
                          <span className="text-sm text-white/40">{msg.timestamp}</span>
                        </div>

                        <p className="mt-1 text-white/80 leading-relaxed">{msg.text}</p>

                        {/* Q&A Upvote Button */}
                        {msg.isQuestion && (
                          <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-1.5">
                            <span className="text-sm font-black uppercase text-gold">Question</span>
                            <button
                              onClick={() => handleUpvoteMessage(msg.id)}
                              className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-sm font-bold text-white hover:bg-gold hover:text-black transition"
                            >
                              <ThumbsUp className="h-3 w-3" />
                              <span>{msg.upvotes || 0}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Chat Composer */}
                <div className="border-t border-white/10 p-2.5 bg-zinc-900 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <label className="flex items-center gap-1.5 cursor-pointer text-white/70">
                      <input
                        type="checkbox"
                        checked={isQuestionInput}
                        onChange={(e) => setIsQuestionInput(e.target.checked)}
                        className="rounded border-white/30 text-gold focus:ring-0"
                      />
                      <span>Mark as Question for Tutor</span>
                    </label>
                  </div>

                  <div className="field-box bg-white/10 border-white/20 px-2.5 py-1.5">
                    <input
                      type="text"
                      placeholder="Type a message or question..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                      className="w-full text-base text-white placeholder:text-white/40 bg-transparent border-none outline-none"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={!chatInput.trim()}
                      className="rounded-lg p-1 text-gold disabled:opacity-40 hover:bg-white/10"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* DRAWER CONTENT B: Participants Roster */}
            {activeDrawer === "participants" && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="p-2 border-b border-white/10">
                  <div className="field-box bg-white/10 border-white/20 px-2 py-1">
                    <Search className="mr-1.5 h-3.5 w-3.5 text-white/40" />
                    <input
                      type="text"
                      placeholder="Search participants..."
                      value={participantSearch}
                      onChange={(e) => setParticipantSearch(e.target.value)}
                      className="w-full text-base text-white placeholder:text-white/40 bg-transparent border-none outline-none"
                    />
                  </div>
                </div>

                <div className="flex-1 space-y-1 p-2 overflow-y-auto">
                  {filteredParticipants.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-xl p-2 hover:bg-white/5 transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={p.avatarUrl}
                          alt={p.name}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-base font-bold text-white">{p.name}</p>
                          <span className="text-sm font-bold text-gold uppercase">
                            {p.role}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {p.hasHandRaised && (
                          <span className="rounded-full bg-gold p-1 text-black">
                            <Hand className="h-3 w-3" />
                          </span>
                        )}
                        {p.isMuted ? (
                          <MicOff className="h-3.5 w-3.5 text-red-400" />
                        ) : (
                          <Mic className="h-3.5 w-3.5 text-green-400" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* 4. Bottom Classroom Control Capsule */}
      <footer className="border-t border-white/10 bg-black-900/95 px-3 py-2.5 backdrop-blur z-20">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-1 sm:gap-2">
          {/* Audio toggle */}
          <button
            onClick={() => setIsMuted((m) => !m)}
            className={`meeting-control-btn ${
              isMuted ? "bg-red-500/20 text-red-400" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            <span className="text-sm">{isMuted ? "Unmute" : "Mute"}</span>
          </button>

          {/* Video toggle */}
          <button
            onClick={() => setIsVideoOn((v) => !v)}
            className={`meeting-control-btn ${
              !isVideoOn ? "bg-red-500/20 text-red-400" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {!isVideoOn ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
            <span className="text-sm">{!isVideoOn ? "Start Video" : "Stop Video"}</span>
          </button>

          {/* Raise Hand Toggle */}
          <button
            onClick={handleToggleHand}
            className={`meeting-control-btn ${
              hasHandRaised
                ? "bg-gold text-black font-black shadow-md scale-105"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            <Hand className="h-5 w-5" />
            <span className="text-sm">{hasHandRaised ? "Lower Hand" : "Raise Hand"}</span>
          </button>

          {/* Screen Share toggle */}
          <button
            onClick={() => setActiveView(activeView === "screen" ? "video" : "screen")}
            className={`hidden sm:flex meeting-control-btn ${
              activeView === "screen" ? "bg-gold text-black font-black" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            <Share2 className="h-5 w-5" />
            <span className="text-sm">Share</span>
          </button>

          {/* Chat toggle */}
          <button
            onClick={() => setActiveDrawer(activeDrawer === "chat" ? "none" : "chat")}
            className={`meeting-control-btn relative ${
              activeDrawer === "chat" ? "bg-gold text-black font-black" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            <MessageSquare className="h-5 w-5" />
            <span className="text-sm">Chat</span>
            {messages.length > 0 && activeDrawer !== "chat" && (
              <span className="absolute top-1 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-[9px] font-black text-black">
                {messages.length}
              </span>
            )}
          </button>

          {/* Participants toggle */}
          <button
            onClick={() => setActiveDrawer(activeDrawer === "participants" ? "none" : "participants")}
            className={`meeting-control-btn relative ${
              activeDrawer === "participants" ? "bg-gold text-black font-black" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            <Users className="h-5 w-5" />
            <span className="text-sm">Roster</span>
            <span className="absolute top-1 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[9px] font-black text-white">
              {participants.length}
            </span>
          </button>

          {/* Leave Meeting Button */}
          <Link
            href="/live"
            className="flex items-center gap-1.5 rounded-2xl bg-red-600 px-4 py-2.5 text-base font-black text-white shadow-md transition hover:bg-red-700 active:scale-95"
          >
            <PhoneOff className="h-4 w-4" />
            <span>Leave</span>
          </Link>
        </div>
      </footer>
    </div>
  );
}
