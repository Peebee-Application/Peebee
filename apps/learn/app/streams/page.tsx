"use client";

import { useState } from "react";
import {
  EDUCATION_STREAMS,
  DEMO_SPROUTS_ACTIVITIES,
  DEMO_SPROUTS_TIMER,
  DEMO_SPROUTS_COPLAY,
  DEMO_FOUNDATIONS_WORKSHEETS,
  DEMO_FOUNDATIONS_SUBMISSIONS,
  DEMO_FOUNDATIONS_MERITS,
  DEMO_ACADEMY_TIMETABLE,
  DEMO_ACADEMY_EXAM,
  DEMO_ACADEMY_REPORT_CARD,
  DEMO_COMPASS_COURSE,
  DEMO_COMPASS_PEER_REVIEW,
  DEMO_COMPASS_CREDENTIAL,
  DEMO_SKILLS_COURSE,
  DEMO_SKILLS_SUBMISSION,
  DEMO_SKILLS_LOGBOOK,
  type EducationStream,
} from "@peebee/shared";
import {
  Sparkles,
  Layers,
  Volume2,
  Clock,
  Camera,
  CheckCircle2,
  Lock,
  Unlock,
  KeyRound,
  FileText,
  Award,
  BookOpen,
  Wrench,
  QrCode,
  ShieldCheck,
  ChevronRight,
  Eye,
  Check,
  Play,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useLearnAuth } from "@/lib/auth-context";

export default function StreamsPage() {
  const { activeStream, setActiveStream } = useLearnAuth();

  // Sprouts demo state
  const [isPlayingPhonics, setIsPlayingPhonics] = useState(false);
  const [sproutsTimerMins, setSproutsTimerMins] = useState(DEMO_SPROUTS_TIMER.minutesRemainingToday);
  const [parentPin, setParentPin] = useState("");
  const [isTimerLocked, setIsTimerLocked] = useState(false);

  // Foundations demo state
  const [worksheetPhoto, setWorksheetPhoto] = useState<string | null>(null);
  const [parentSignDone, setParentSignDone] = useState(false);

  // Academy demo state
  const [examTabSwitches, setExamTabSwitches] = useState(0);
  const [examSubmitted, setExamSubmitted] = useState(false);

  // Skills critique state
  const [activeCritiquePin, setActiveCritiquePin] = useState(DEMO_SKILLS_SUBMISSION.critiques[0]);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <h1 className="text-2xl font-black text-ink">Preview</h1>

      {/* Stream Tabs Bar */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {EDUCATION_STREAMS.map((st) => {
          const isSelected = activeStream === st.id;
          return (
            <button
              key={st.id}
              onClick={() => setActiveStream(st.id as EducationStream)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-base font-bold transition-all ${
                isSelected
                  ? "bg-gold text-black shadow-sm font-black"
                  : "border border-[var(--border-faint)] bg-cream/70 text-ink-500 hover:text-ink dark:bg-black/40"
              }`}
            >
              <span className="text-lg">{st.icon}</span>
              <span>{st.title}</span>
              <span className="text-sm opacity-75">({st.ageBracket})</span>
            </button>
          );
        })}
      </div>

      {/* Active Stream Interactive Engine */}
      {/* 1. SPROUTS */}
      {activeStream === "sprouts" && (
        <div className="space-y-4">
          <div className="home-card bg-gradient-to-br from-gold/10 via-cream to-cream p-5 dark:from-gold/10 dark:via-black-700">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-sm font-black uppercase text-gold">
                Ages 3–6 • Tablet-First & Audio Nav
              </span>
              <span className="flex items-center gap-1 text-base font-bold text-ink-500">
                <Clock className="h-3.5 w-3.5" /> {sproutsTimerMins}m screen time left
              </span>
            </div>
            <h2 className="mt-2 text-base font-black text-ink">
              Sprouts Storybook & Audio Guide (Kigo the Crane)
            </h2>
            <p className="mt-1 text-base text-ink-500">
              Large interactive graphics with synchronized Luganda/English phonics narration.
            </p>

            {/* Audio Storybook simulator */}
            <div className="mt-4 rounded-2xl border border-[var(--border-faint)] bg-cream p-4 dark:bg-black/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIsPlayingPhonics(!isPlayingPhonics)}
                    className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold text-black shadow-md hover:scale-105 transition"
                  >
                    {isPlayingPhonics ? <Clock className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
                  </button>
                  <div>
                    <h3 className="text-base font-black text-ink">
                      Story: &quot;Kigo the Crested Crane Visits Lake Victoria&quot;
                    </h3>
                    <p className="text-sm text-gold font-bold">
                      {isPlayingPhonics ? "Narration Playing in Luganda & English..." : "Tap to Listen"}
                    </p>
                  </div>
                </div>

                <span className="text-2xl">🦩</span>
              </div>
            </div>

            {/* Sticker Collection */}
            <div className="mt-4 border-t border-[var(--border-faint)] pt-3">
              <p className="text-base font-black text-ink">Unlocked Digital Stickers</p>
              <div className="mt-2 flex gap-3">
                <span className="rounded-2xl border border-gold/40 bg-gold/10 p-2 text-2xl" title="Golden Lion">
                  🦁
                </span>
                <span className="rounded-2xl border border-gold/40 bg-gold/10 p-2 text-2xl" title="Crowned Crane">
                  👑
                </span>
                <span className="rounded-2xl border border-dashed border-[var(--border-faint)] p-2 text-2xl opacity-40">
                  🔒
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. FOUNDATIONS */}
      {activeStream === "foundations" && (
        <div className="space-y-4">
          <div className="home-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-sm font-black uppercase text-gold">
                Ages 6–12 • Primary School & Parent Monitored
              </span>
              <span className="flex items-center gap-1 text-base font-bold text-gold">
                <Award className="h-3.5 w-3.5" /> {DEMO_FOUNDATIONS_MERITS.totalMerits} Merits Earned
              </span>
            </div>

            <h2 className="text-base font-black text-ink">
              Worksheet Photo Submission & Parent Sign-Off Engine
            </h2>
            <p className="text-base text-ink-500">
              Students take a mobile photo of handwritten homework; parent signs off with verified PIN.
            </p>

            <div className="rounded-2xl border border-[var(--border-faint)] p-4 bg-cream-50/50 dark:bg-black/30 space-y-3">
              <div className="flex items-center justify-between text-base">
                <span className="font-bold text-ink">Current Assignment:</span>
                <span className="rounded bg-gold/15 px-2 py-0.5 font-bold text-gold">Due Friday</span>
              </div>
              <p className="text-base font-black text-ink">
                {DEMO_FOUNDATIONS_WORKSHEETS[0].title}
              </p>

              {/* Photo scanner mock */}
              <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--border-faint)] p-6 text-center">
                {worksheetPhoto ? (
                  <div className="space-y-2">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-green-500" />
                    <p className="text-base font-bold text-ink">Homework Photo Captured</p>
                  </div>
                ) : (
                  <div>
                    <Camera className="mx-auto h-8 w-8 text-gold" />
                    <button
                      onClick={() => setWorksheetPhoto("captured_photo.jpg")}
                      className="mt-2 rounded-xl bg-gold px-3 py-1.5 text-base font-black text-black"
                    >
                      Scan Handwritten Worksheet
                    </button>
                  </div>
                )}
              </div>

              {/* Parent PIN Sign-off */}
              <div className="border-t border-[var(--border-faint)] pt-3 flex items-center justify-between">
                <div>
                  <p className="text-base font-bold text-ink">Parent Digital Sign-Off</p>
                  <p className="text-sm text-ink-500">Guardian: Grace Mukasa</p>
                </div>
                {parentSignDone ? (
                  <span className="flex items-center gap-1 text-base font-bold text-green-600">
                    <CheckCircle2 className="h-4 w-4" /> Signed & Verified
                  </span>
                ) : (
                  <button
                    onClick={() => setParentSignDone(true)}
                    className="rounded-xl border border-gold px-3 py-1.5 text-base font-bold text-gold hover:bg-gold hover:text-black transition"
                  >
                    Sign with Parent PIN
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. ACADEMY */}
      {activeStream === "academy" && (
        <div className="space-y-4">
          <div className="home-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-sm font-black uppercase text-gold">
                Ages 12–18 • High School & UNEB Revision
              </span>
              <span className="rounded bg-red-500/10 px-2 py-0.5 text-sm font-black uppercase text-red-600 dark:text-red-400">
                Anti-Cheat Enabled
              </span>
            </div>

            <h2 className="text-base font-black text-ink">
              UNEB Examination Simulator & Automated Gradebook
            </h2>
            <p className="text-base text-ink-500">
              Timed examination interface with tab-switch detection and terminal weighted report cards.
            </p>

            <div className="rounded-2xl border border-[var(--border-faint)] p-4 bg-cream-50/50 dark:bg-black/30 space-y-3">
              <div className="flex items-center justify-between text-base">
                <span className="font-black text-ink">Active Mock Exam:</span>
                <span className="font-mono text-base font-bold text-gold">Time: 90 Mins</span>
              </div>
              <p className="text-base font-bold text-ink">{DEMO_ACADEMY_EXAM.title}</p>

              {/* Anti-cheat tab alert */}
              <div className="flex items-center justify-between rounded-xl bg-gold/10 p-2.5 text-base">
                <span className="text-ink-500">Integrity Monitor:</span>
                <span className="font-bold text-gold">
                  {examTabSwitches} Tab-Switch Violations Detected
                </span>
              </div>

              {/* Terminal Report Card Preview */}
              <div className="border-t border-[var(--border-faint)] pt-3">
                <p className="text-base font-black text-ink">Terminal Report Card Summary</p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-base">
                  <div className="rounded-xl border border-[var(--border-faint)] p-2">
                    <p className="text-ink-500 text-sm">Weighted Avg</p>
                    <p className="font-black text-ink">{DEMO_ACADEMY_REPORT_CARD.overallWeightedAverage}%</p>
                  </div>
                  <div className="rounded-xl border border-[var(--border-faint)] p-2">
                    <p className="text-ink-500 text-sm">Rank in Class</p>
                    <p className="font-black text-gold">{DEMO_ACADEMY_REPORT_CARD.classRank}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--border-faint)] p-2">
                    <p className="text-ink-500 text-sm">Attendance</p>
                    <p className="font-black text-green-600">
                      {DEMO_ACADEMY_REPORT_CARD.attendancePercent}%
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. COMPASS */}
      {activeStream === "compass" && (
        <div className="space-y-4">
          <div className="home-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-sm font-black uppercase text-gold">
                Higher Ed & Professional Degrees
              </span>
              <span className="flex items-center gap-1 text-base font-bold text-ink-500">
                <QrCode className="h-3.5 w-3.5 text-gold" /> Verifiable Credential
              </span>
            </div>

            <h2 className="text-base font-black text-ink">
              Modular Syllabus, Peer Review & Verifiable Credentials
            </h2>
            <p className="text-base text-ink-500">
              Multi-tier modular curriculum with double-blind peer assessment and LinkedIn-ready certificates.
            </p>

            {/* Course Syllabus Preview */}
            <div className="rounded-2xl border border-[var(--border-faint)] p-4 bg-cream-50/50 dark:bg-black/30 space-y-2">
              <p className="text-base font-black text-ink">{DEMO_COMPASS_COURSE.title}</p>
              <div className="space-y-1.5 text-base text-ink-500">
                {DEMO_COMPASS_COURSE.syllabus.map((mod) => (
                  <div
                    key={mod.id}
                    className="flex items-center justify-between rounded-xl border border-[var(--border-faint)] bg-cream p-2.5 dark:bg-black/40"
                  >
                    <span>{mod.title}</span>
                    <span className="text-sm font-bold text-gold">{mod.sections.length} Sections</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Verifiable Certificate Card */}
            <div className="rounded-2xl border border-gold/40 bg-gold/5 p-4 flex items-center justify-between">
              <div>
                <p className="text-base font-black text-ink">
                  {DEMO_COMPASS_CREDENTIAL.courseTitle}
                </p>
                <p className="font-mono text-sm text-ink-500">
                  Verification Hash: {DEMO_COMPASS_CREDENTIAL.verificationHash}
                </p>
              </div>
              <button className="rounded-xl bg-gold px-3 py-1.5 text-base font-black text-black">
                Verify
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. SKILLS */}
      {activeStream === "skills" && (
        <div className="space-y-4">
          <div className="home-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-sm font-black uppercase text-gold">
                Vocational, Trades & Practical Training
              </span>
              <span className="text-base font-bold text-gold">DIT Accredited</span>
            </div>

            <h2 className="text-base font-black text-ink">
              Video Timestamp Critique & Digital Apprentice Logbook
            </h2>
            <p className="text-base text-ink-500">
              Students record physical skill demonstrations; master artisans pin critiques onto specific video timestamps.
            </p>

            {/* Critique Pins Interface */}
            <div className="rounded-2xl border border-[var(--border-faint)] p-4 bg-cream-50/50 dark:bg-black/30 space-y-3">
              <div className="flex items-center justify-between text-base">
                <span className="font-bold text-ink">Practical Video Submission:</span>
                <span className="rounded bg-gold/15 px-2 py-0.5 font-bold text-gold">
                  {DEMO_SKILLS_SUBMISSION.trade}
                </span>
              </div>
              <p className="text-base font-black text-ink">{DEMO_SKILLS_SUBMISSION.taskTitle}</p>

              {/* Timestamp critique markers */}
              <div className="space-y-2">
                <p className="text-sm font-bold text-ink-500">Instructor Timestamp Pins:</p>
                {DEMO_SKILLS_SUBMISSION.critiques.map((crit) => (
                  <div
                    key={crit.id}
                    className="flex items-start justify-between rounded-xl border border-[var(--border-faint)] bg-cream p-2.5 text-base dark:bg-black/40"
                  >
                    <div>
                      <span className="font-mono text-sm font-black text-gold">
                        At 01:28
                      </span>
                      <p className="text-ink font-bold mt-0.5">{crit.critiqueText}</p>
                      <p className="text-sm text-ink-500">By {crit.instructorName}</p>
                    </div>
                    <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-sm font-bold text-green-600">
                      Resolved
                    </span>
                  </div>
                ))}
              </div>

              {/* Apprentice Logbook tracker */}
              <div className="border-t border-[var(--border-faint)] pt-3">
                <p className="text-base font-black text-ink">Apprentice Practical Logbook</p>
                <div className="mt-2 space-y-1.5 text-base text-ink-500">
                  {DEMO_SKILLS_LOGBOOK.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between rounded-xl border border-[var(--border-faint)] p-2"
                    >
                      <div>
                        <p className="font-bold text-ink">{log.taskPerformed}</p>
                        <p className="text-sm">{log.workshopLocation} • {log.date}</p>
                      </div>
                      <span className="font-black text-gold">{log.practicalHours} hrs</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
