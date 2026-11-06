"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Video,
  Radio,
  Users,
  Clock,
  Sparkles,
  Calendar,
  Layers,
  ChevronRight,
  PlayCircle,
  Search,
} from "lucide-react";
import {
  DEMO_LIVE_MEETINGS,
  EDUCATION_STREAMS,
  type EducationStream,
} from "@peebee/shared";

export default function LiveMeetingsDirectoryPage() {
  const [selectedStream, setSelectedStream] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredMeetings = DEMO_LIVE_MEETINGS.filter((m) => {
    const matchesStream = selectedStream === "all" || m.stream === selectedStream;
    const matchesQuery =
      m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.hostTutorName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStream && matchesQuery;
  });

  const liveNow = filteredMeetings.filter((m) => m.isLiveNow);
  const scheduled = filteredMeetings.filter((m) => !m.isLiveNow);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div>
        <p className="text-sm font-black uppercase tracking-wider text-gold">
          Interactive Live Video
        </p>
        <h1 className="text-xl font-black text-ink">Live Classrooms & Masterclasses</h1>
        <p className="mt-1 text-base text-ink-500">
          Join synchronous Zoom-style video lectures, whiteboard workshops, and peer revision rooms.
        </p>
      </div>

      {/* Search & Stream Filter */}
      <div className="space-y-2">
        <div className="field-box px-3 py-2.5">
          <Search className="mr-2 h-4 w-4 text-ink-500" />
          <input
            type="text"
            placeholder="Search classes, tutors, subjects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-base font-medium text-ink placeholder:text-ink-500/50"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedStream("all")}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-base font-bold transition-all ${
              selectedStream === "all"
                ? "bg-gold text-black font-black"
                : "border border-[var(--border-faint)] bg-cream/70 text-ink-500 hover:text-ink dark:bg-black/40"
            }`}
          >
            All Streams
          </button>
          {EDUCATION_STREAMS.map((st) => (
            <button
              key={st.id}
              onClick={() => setSelectedStream(st.id)}
              className={`flex shrink-0 items-center gap-1 rounded-xl px-3 py-1.5 text-base font-bold transition-all ${
                selectedStream === st.id
                  ? "bg-gold text-black font-black"
                  : "border border-[var(--border-faint)] bg-cream/70 text-ink-500 hover:text-ink dark:bg-black/40"
              }`}
            >
              <span>{st.icon}</span>
              <span>{st.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Live Right Now Section */}
      {liveNow.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-gold" />
            <h2 className="text-base font-semibold uppercase tracking-wider text-gold">
              Live Streaming Right Now ({liveNow.length})
            </h2>
          </div>

          <div className="space-y-3">
            {liveNow.map((meeting) => (
              <div
                key={meeting.id}
                className="home-card relative overflow-hidden border border-gold/40 p-5 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-sm font-semibold uppercase text-gold">
                      Room: {meeting.roomCode}
                    </span>
                    <h3 className="mt-2 font-display text-base font-semibold text-ink">{meeting.title}</h3>
                    <p className="mt-0.5 text-base text-ink-500">
                      {meeting.subject} • Hosted by{" "}
                      <span className="font-semibold text-ink">{meeting.hostTutorName}</span>
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-gold/15 px-2.5 py-1 text-sm font-semibold text-gold">
                    <Users className="h-3.5 w-3.5" />
                    {meeting.participantCount}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-faint)] pt-3">
                  <div className="flex items-center gap-3 text-base text-ink-500">
                    <span className="flex items-center gap-1 font-semibold text-gold">
                      <Sparkles className="h-3.5 w-3.5" /> Whiteboard Ready
                    </span>
                    <span>•</span>
                    <span>{meeting.durationMinutes} min session</span>
                  </div>

                  <Link
                    href={`/live/${meeting.id}`}
                    className="flex items-center gap-1.5 rounded-xl bg-gold px-4 py-2 text-base font-semibold text-ink-gold transition"
                  >
                    <Video className="h-4 w-4" />
                    Enter Classroom
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Scheduled Live Classes */}
      <section className="space-y-3">
        <h2 className="font-display text-base font-semibold text-ink">Upcoming Scheduled Classes</h2>

        <div className="space-y-2.5">
          {scheduled.map((meeting) => (
            <div
              key={meeting.id}
              className="home-card p-4 transition hover:border-gold/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-gold/15 px-2 py-0.5 text-sm font-semibold text-gold uppercase">
                      {meeting.stream}
                    </span>
                    <span className="text-sm font-medium text-ink-500">
                      {meeting.scheduledFor}
                    </span>
                  </div>
                  <h3 className="mt-1 font-display text-lg font-semibold text-ink">{meeting.title}</h3>
                  <p className="mt-0.5 text-base text-ink-500">
                    {meeting.hostTutorName} • {meeting.hostTutorTitle}
                  </p>
                </div>

                <Link
                  href={`/live/${meeting.id}`}
                  className="shrink-0 rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] px-3 py-1.5 text-base font-semibold text-ink transition hover:border-gold/40"
                >
                  Enter Room
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Classroom Recordings Tray */}
      <section className="home-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlayCircle className="h-4 w-4 text-gold" />
            <h2 className="font-display text-lg font-semibold text-ink">Recent Class Playbacks</h2>
          </div>
          <span className="text-base font-medium text-ink-500">2 Available</span>
        </div>
        <p className="mt-1 text-base text-ink-500">
          Rewatch past live classes with synced transcripts and time-indexed notes.
        </p>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between rounded-xl border border-[var(--border-faint)] p-2.5">
            <div>
              <p className="text-base font-semibold text-ink">
                FinTech 101: Core Banking Ledgers & Webhooks
              </p>
              <p className="text-sm text-ink-500">Streamed Yesterday • 52 mins • Dr. Kenneth Ochieng</p>
            </div>
            <Link
              href="/live/live_fintech_101"
              className="rounded-lg bg-gold px-3 py-1 text-base font-semibold text-ink-gold"
            >
              Watch
            </Link>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-[var(--border-faint)] p-2.5">
            <div>
              <p className="text-base font-semibold text-ink">
                P.4 Math: Fractions & Decimal Placement Workshop
              </p>
              <p className="text-sm text-ink-500">Streamed 2 days ago • 40 mins • Tr. Brenda Namutebi</p>
            </div>
            <Link
              href="/live/live_primary_math_401"
              className="rounded-lg bg-gold px-3 py-1 text-base font-semibold text-ink-gold"
            >
              Watch
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
