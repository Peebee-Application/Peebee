"use client";

import { useState } from "react";
import Link from "next/link";
import {
  PRACTICE_JOURNEYS,
  startPracticeMode,
  exitPracticeMode,
  isPracticeMode,
} from "@peebee/shared";
import {
  Sparkles,
  CheckCircle2,
  Video,
  MessageSquare,
  Award,
  Clock,
  ShieldCheck,
  ChevronRight,
  RotateCcw,
  Volume2,
  Camera,
  Layers,
  HelpCircle,
  ThumbsUp,
  QrCode,
  Hand,
  PenTool,
  ArrowRight,
  KeyRound,
  FileText,
} from "lucide-react";

const JOURNEY = PRACTICE_JOURNEYS.learner;

export default function LearnPracticePage() {
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([0]);

  // Step 1: Sprouts State
  const [sproutsPlaying, setSproutsPlaying] = useState(false);
  const [sproutsStickerUnlocked, setSproutsStickerUnlocked] = useState(true);

  // Step 2: Foundations State
  const [homeworkScanned, setHomeworkScanned] = useState(false);
  const [parentPin, setParentPin] = useState("1234");
  const [parentSigned, setParentSigned] = useState(false);

  // Step 3: Academy State
  const [tabSwitchCount, setTabSwitchCount] = useState(1);
  const [examSubmitted, setExamSubmitted] = useState(false);

  // Step 4: Live Meeting State
  const [handRaised, setHandRaised] = useState(false);
  const [questionUpvoted, setQuestionUpvoted] = useState(false);

  // Step 5: Tutor Chat State
  const [chatSent, setChatSent] = useState(false);
  const [voicePlaying, setVoicePlaying] = useState(false);

  // Step 6: Compass State
  const [peerReviewScored, setPeerReviewScored] = useState(false);
  const [credentialVerified, setCredentialVerified] = useState(false);

  // Step 7: Skills State
  const [critiquePinClicked, setCritiquePinClicked] = useState(false);
  const [logHoursRecorded, setLogHoursRecorded] = useState(false);

  const markStepDone = (index: number) => {
    if (!completedSteps.includes(index)) {
      setCompletedSteps([...completedSteps, index]);
    }
    if (index + 1 < JOURNEY.steps.length) {
      setActiveStep(index + 1);
    }
  };

  const handleResetSandbox = () => {
    setCompletedSteps([0]);
    setActiveStep(0);
    setHomeworkScanned(false);
    setParentSigned(false);
    setExamSubmitted(false);
    setHandRaised(false);
    setQuestionUpvoted(false);
    setChatSent(false);
    setPeerReviewScored(false);
    setCredentialVerified(false);
    setCritiquePinClicked(false);
    setLogHoursRecorded(false);
  };

  return (
    <div className="space-y-5">
      {/* Sandbox Header Banner */}
      <div className="relative overflow-hidden rounded-3xl border-2 border-gold/40 bg-gradient-to-br from-gold/20 via-cream to-cream p-5 shadow-sm dark:from-gold/10 dark:via-black-700 dark:to-black-900">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-base font-black uppercase text-black shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
            Sandbox & Practice Environment
          </span>
          <span className="text-base font-bold text-ink-500">
            Safe Mode • Zero Live Production Impact
          </span>
        </div>

        <h1 className="mt-2.5 text-xl font-black text-ink">{JOURNEY.heading}</h1>
        <p className="mt-1 text-base text-ink-500 leading-relaxed max-w-xl">
          {JOURNEY.introduction}
        </p>

        {/* Quick action bar */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href="/live/live_fintech_101"
            className="flex items-center gap-1.5 rounded-2xl bg-gold px-4 py-2 text-base font-black text-black shadow-sm transition hover:opacity-90 active:scale-95"
          >
            <Video className="h-3.5 w-3.5" />
            Launch Zoom Classroom
          </Link>

          <Link
            href="/chat"
            className="flex items-center gap-1.5 rounded-2xl border border-[var(--border-faint)] bg-cream px-3.5 py-2 text-base font-bold text-ink hover:border-gold dark:bg-black/40"
          >
            <MessageSquare className="h-3.5 w-3.5 text-gold" />
            Live Tutor Chat
          </Link>

          <button
            onClick={handleResetSandbox}
            className="flex items-center gap-1 text-base font-bold text-ink-500 hover:text-ink ml-auto"
          >
            <RotateCcw className="h-3 w-3" /> Reset Demo
          </button>
        </div>
      </div>

      {/* Interactive Step Navigator */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Step List Sidebar */}
        <div className="home-card p-3 space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-base font-black uppercase tracking-wider text-ink-500">
              Learning Modules ({completedSteps.length}/{JOURNEY.steps.length})
            </h2>
          </div>

          <div className="space-y-1">
            {JOURNEY.steps.map((step, idx) => {
              const isCurrent = activeStep === idx;
              const isDone = completedSteps.includes(idx);
              return (
                <button
                  key={idx}
                  onClick={() => setActiveStep(idx)}
                  className={`flex w-full items-start gap-2.5 rounded-2xl p-2.5 text-left transition ${
                    isCurrent
                      ? "bg-gold/15 border border-gold/40 shadow-sm"
                      : "hover:bg-cream-100 border border-transparent dark:hover:bg-black/30"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-sm font-black ${
                      isDone
                        ? "bg-green-500 text-white"
                        : isCurrent
                        ? "bg-gold text-black"
                        : "bg-ink-500/20 text-ink-500"
                    }`}
                  >
                    {isDone ? "✓" : idx + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className={`text-base ${isCurrent ? "font-black text-ink" : "font-bold text-ink-500"}`}>
                      {step.title}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Interactive Step Workstation */}
        <div className="home-card md:col-span-2 p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-sm font-black uppercase text-gold">
                Module {activeStep + 1} of {JOURNEY.steps.length}
              </span>
              <span className="text-base font-bold text-green-600 dark:text-green-400">
                {completedSteps.includes(activeStep) ? "✓ Completed in Sandbox" : "Pending Sandbox Test"}
              </span>
            </div>

            <h3 className="mt-2 text-base font-black text-ink">
              {JOURNEY.steps[activeStep].title}
            </h3>
            <p className="mt-1 text-base text-ink-500 leading-relaxed">
              {JOURNEY.steps[activeStep].description}
            </p>

            {/* DEMO WORKSTATION CONTROLS PER STEP */}
            <div className="mt-5 rounded-2xl border border-[var(--border-faint)] bg-cream-50/50 p-4 dark:bg-black/30">
              {/* Step 0: Sprouts */}
              {activeStep === 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setSproutsPlaying(!sproutsPlaying)}
                        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold text-black shadow-md hover:scale-105 transition"
                      >
                        <Volume2 className="h-6 w-6" />
                      </button>
                      <div>
                        <p className="text-base font-black text-ink">Kigo the Crested Crane Phonics</p>
                        <p className="text-sm text-gold font-bold">
                          {sproutsPlaying ? "Luganda Phonics Playing (Vowels: A, E, I, O, U)..." : "Tap to Play Narration"}
                        </p>
                      </div>
                    </div>
                    <span className="text-3xl">🦁</span>
                  </div>

                  <div className="flex items-center justify-between border-t border-[var(--border-faint)] pt-2.5">
                    <span className="text-base font-bold text-ink">Reward Sticker Album:</span>
                    <span className="rounded-xl border border-gold/40 bg-gold/10 px-3 py-1 text-base font-bold text-gold">
                      👑 Crowned Crane Unlocked!
                    </span>
                  </div>
                </div>
              )}

              {/* Step 1: Foundations */}
              {activeStep === 1 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-base">
                    <span className="font-bold text-ink">Assignment: P.4 Fractions & Decimals</span>
                    <span className="rounded bg-gold/15 px-2 py-0.5 font-bold text-gold">+25 Merit Stars</span>
                  </div>

                  <div className="rounded-xl border-2 border-dashed border-[var(--border-faint)] p-4 text-center">
                    {homeworkScanned ? (
                      <p className="text-base font-bold text-green-600">✓ Handwritten Worksheet Photo Attached</p>
                    ) : (
                      <button
                        onClick={() => setHomeworkScanned(true)}
                        className="flex items-center gap-1.5 mx-auto rounded-xl bg-gold px-3.5 py-1.5 text-base font-black text-black"
                      >
                        <Camera className="h-4 w-4" /> Simulate Homework Photo Scan
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-[var(--border-faint)] pt-2.5 text-base">
                    <div>
                      <p className="font-bold text-ink">Parent Digital Sign-Off</p>
                      <p className="text-sm text-ink-500">Guardian PIN: 1234</p>
                    </div>
                    {parentSigned ? (
                      <span className="font-bold text-green-600">✓ Signed by Grace Mukasa</span>
                    ) : (
                      <button
                        onClick={() => {
                          setParentSigned(true);
                          markStepDone(1);
                        }}
                        className="rounded-xl border border-gold px-3 py-1.5 font-bold text-gold hover:bg-gold hover:text-black transition"
                      >
                        Sign with Parent PIN
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Academy */}
              {activeStep === 2 && (
                <div className="space-y-3 text-base">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-ink">UNEB S.4 Physics & Mechanics Exam</span>
                    <span className="font-mono font-bold text-gold">Time: 90 Mins</span>
                  </div>

                  <div className="rounded-xl bg-gold/10 p-3 flex items-center justify-between">
                    <span>Browser Visibility Anti-Cheat Monitor:</span>
                    <span className="font-bold text-gold">
                      {tabSwitchCount} Tab Switch Violations Logged
                    </span>
                  </div>

                  {examSubmitted ? (
                    <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3">
                      <p className="font-black text-green-700 dark:text-green-400">
                        Exam Graded: 88% (Distinction 1 - D1)
                      </p>
                      <p className="text-sm text-ink-500 mt-0.5">
                        Weighted report card generated: Homework (20%), Midterm (30%), Final Exam (50%).
                      </p>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setExamSubmitted(true);
                        markStepDone(2);
                      }}
                      className="w-full rounded-xl bg-gold py-2 font-black text-black"
                    >
                      Simulate Timed Exam Submission
                    </button>
                  )}
                </div>
              )}

              {/* Step 3: Zoom Classroom */}
              {activeStep === 3 && (
                <div className="space-y-3 text-base">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-ink">Room PB-FIN-101: FinTech Masterclass</span>
                    <span className="rounded bg-red-500/15 px-2 py-0.5 font-black text-red-600">
                      🔴 Live (28 in Room)
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setHandRaised(!handRaised)}
                      className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 font-bold transition ${
                        handRaised ? "bg-gold text-black border-gold font-black" : "border-[var(--border-faint)] text-ink"
                      }`}
                    >
                      <Hand className="h-4 w-4" />
                      <span>{handRaised ? "Hand Raised (Host Alerted)" : "Raise Hand"}</span>
                    </button>

                    <button
                      onClick={() => setQuestionUpvoted(!questionUpvoted)}
                      className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 font-bold transition ${
                        questionUpvoted ? "bg-gold text-black border-gold font-black" : "border-[var(--border-faint)] text-ink"
                      }`}
                    >
                      <ThumbsUp className="h-4 w-4" />
                      <span>{questionUpvoted ? "Question Upvoted (+8)" : "Upvote Q&A"}</span>
                    </button>
                  </div>

                  <Link
                    href="/live/live_fintech_101"
                    className="flex items-center justify-center gap-2 rounded-xl bg-gold py-2 font-black text-black"
                  >
                    <Video className="h-4 w-4" /> Open Full Classroom Meeting UI
                  </Link>
                </div>
              )}

              {/* Step 4: Tutor Chat */}
              {activeStep === 4 && (
                <div className="space-y-3 text-base">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      <span className="font-black text-ink">Dr. Kenneth Ochieng (Senior Fellow)</span>
                    </div>
                    <span className="text-sm text-ink-500">Office Hours: 2:00 - 4:00 PM</span>
                  </div>

                  <div className="rounded-xl border border-[var(--border-faint)] bg-cream p-2.5 dark:bg-black/40 space-y-1">
                    <p className="font-bold text-gold text-sm">Tutor Voice Note (0:24):</p>
                    <p className="text-ink-500 text-sm">
                      &quot;Here is the store-and-forward queue mechanism for the MoMo reversal webhook.&quot;
                    </p>
                  </div>

                  <Link
                    href="/chat"
                    className="flex items-center justify-center gap-2 rounded-xl bg-gold py-2 font-black text-black"
                  >
                    <MessageSquare className="h-4 w-4" /> Open Live Tutor Chat Screen
                  </Link>
                </div>
              )}

              {/* Step 5: Compass Credential */}
              {activeStep === 5 && (
                <div className="space-y-3 text-base">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-ink">Executive FinTech Product Management</span>
                    <span className="font-mono text-gold font-bold">12 Modules</span>
                  </div>

                  <div className="rounded-xl border border-gold/40 bg-gold/10 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-ink">Verifiable Certificate of Completion</span>
                      <QrCode className="h-5 w-5 text-gold" />
                    </div>
                    <p className="font-mono text-sm text-ink-500 mt-1">
                      Hash: SHA-256 e4b8...c721 • Tamper-proof
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setCredentialVerified(true);
                      markStepDone(5);
                    }}
                    className="w-full rounded-xl bg-gold py-2 font-black text-black"
                  >
                    Simulate Cryptographic Verification
                  </button>
                </div>
              )}

              {/* Step 6: Skills Trade Logbook */}
              {activeStep === 6 && (
                <div className="space-y-3 text-base">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-ink">Master Barbering & Precision Fades</span>
                    <span className="font-bold text-gold">DIT UVQF Level 2</span>
                  </div>

                  <div className="rounded-xl border border-[var(--border-faint)] bg-cream p-3 dark:bg-black/40 space-y-1">
                    <p className="font-bold text-ink">Critique Pin at 01:28:</p>
                    <p className="text-ink-500 text-sm">
                      &quot;Adjust your clipper blade angle here to prevent irritation on the neck.&quot;
                    </p>
                    <p className="text-sm text-gold font-bold">By Master Alex Mukasa</p>
                  </div>

                  <button
                    onClick={() => {
                      setLogHoursRecorded(true);
                      markStepDone(6);
                    }}
                    className="w-full rounded-xl bg-gold py-2 font-black text-black"
                  >
                    Record 4 Apprentice Hours & Sign Off
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-between border-t border-[var(--border-faint)] pt-3">
            <span className="text-base font-bold text-gold">
              Action: {JOURNEY.steps[activeStep].actionLabel}
            </span>
            <button
              onClick={() => markStepDone(activeStep)}
              className="flex items-center gap-1.5 rounded-2xl bg-gold px-4 py-2 text-base font-black text-black shadow-sm transition hover:opacity-90 active:scale-95"
            >
              <span>Advance Sandbox</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
