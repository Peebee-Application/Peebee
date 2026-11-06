import type { ClassKind, CurriculumFramework, EducationStream } from "./types.js";

/**
 * Peebee Learn Studio — the persisted school → class → course → module → lesson
 * builder. Everything an educator creates lives in these shapes; the Admin app
 * controls the limits (see LearnSettings).
 */

export type SchoolKind = "school" | "academy" | "college" | "training_centre" | "independent_tutor";

export const SCHOOL_KINDS: { id: SchoolKind; label: string }[] = [
  { id: "school", label: "School" },
  { id: "academy", label: "Academy or institute" },
  { id: "college", label: "College or university" },
  { id: "training_centre", label: "Training centre" },
  { id: "independent_tutor", label: "Independent tutor" },
];

/** What one item in a class section is. Quizzes and exams are items of their own, placed wherever the creator likes. */
export type LessonContentType = "text" | "slides" | "audio" | "video" | "live" | "quiz" | "exam" | "assignment";

export const LESSON_CONTENT_TYPES: { id: LessonContentType; label: string; hint: string }[] = [
  { id: "text", label: "Text", hint: "A written lesson" },
  { id: "slides", label: "Slides", hint: "A deck the learner swipes through" },
  { id: "audio", label: "Audio", hint: "A recording or a link to one" },
  { id: "video", label: "Video", hint: "An uploaded video or a link" },
  { id: "live", label: "Live video", hint: "A scheduled live lesson on Zoom, Meet or Jitsi" },
  { id: "quiz", label: "Quiz", hint: "Questions that can be retaken" },
  { id: "exam", label: "Exam", hint: "A timed test, usually one attempt" },
  { id: "assignment", label: "Assignment", hint: "Work the learner hands in and you mark" },
];

export const isAssessment = (type: string): boolean => type === "quiz" || type === "exam";

/** Older lessons were saved with other type names; this reads any of them as one of the current ones. */
export function normaliseContentType(raw: string): LessonContentType {
  if (LESSON_CONTENT_TYPES.some((t) => t.id === raw)) return raw as LessonContentType;
  if (raw === "reading" || raw === "interactive_h5p") return "text";
  if (raw === "audio_story") return "audio";
  return "video";
}

export type StudioStatus = "draft" | "published";
export type SchoolStatus = "active" | "suspended";

export type QuestionType = "single" | "multiple" | "true_false" | "fill_blank" | "short_answer" | "ordering" | "matching";

export const QUESTION_TYPE_LABELS: { id: QuestionType; label: string; hint: string }[] = [
  { id: "single", label: "One correct answer", hint: "Pick one choice" },
  { id: "multiple", label: "Several correct answers", hint: "Pick every right choice" },
  { id: "true_false", label: "True or false", hint: "A statement to judge" },
  { id: "fill_blank", label: "Fill in the blank", hint: "Type the missing word" },
  { id: "short_answer", label: "Short answer", hint: "Type a word or short phrase" },
  { id: "ordering", label: "Put in order", hint: "Arrange the items" },
  { id: "matching", label: "Match the pairs", hint: "Join each item to its partner" },
];

/** A question as the creator writes it. Which fields apply depends on `type` (older questions have none and are "single"). */
export interface StudioQuizQuestion {
  id?: string;
  type?: QuestionType;
  question: string;
  explanation?: string;
  points?: number;
  /** single, multiple: the choices. ordering: the items in their correct order. */
  options?: string[];
  correctIndex?: number;
  correctIndexes?: number[];
  answerBool?: boolean;
  /** fill_blank, short_answer: every accepted answer. */
  accepted?: string[];
  /** matching */
  pairs?: { left: string; right: string }[];
}

export interface StudioQuizSettings {
  /** 0 means untimed. */
  timeLimitMinutes: number;
  /** 0 means the platform limit applies. */
  maxAttempts: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  /** Draw this many questions for each attempt. 0 means all. */
  questionsPerAttempt: number;
}

export interface StudioQuiz {
  title: string;
  passingScorePercent: number;
  questions: StudioQuizQuestion[];
  settings?: Partial<StudioQuizSettings>;
}

export interface StudioSlide {
  title: string;
  body: string;
  imageUrl: string;
}

/** A live lesson on someone else's meeting tool. */
/** What an educator sets for an assignment item. */
export interface StudioAssignment {
  maxPoints: number;
  /** Percent of the points needed for the item to count as done. */
  passPercent: number;
  /** ISO time after which nothing can be handed in, or null. */
  dueAt: string | null;
  allowResubmit: boolean;
}

export interface StudioCoupon {
  id: string;
  code: string;
  percentOff: number | null;
  amountOffUgx: number | null;
  courseId: string | null;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  active: boolean;
}

export interface StudioBundle {
  id: string;
  title: string;
  summary: string;
  priceUgx: number;
  status: "draft" | "published";
  sold: number;
  courseIds: string[];
}

export interface StudioPlan {
  id: string;
  title: string;
  summary: string;
  priceUgx: number;
  days: number;
  status: "draft" | "published";
  sold: number;
}

export interface SalesOverview {
  ready: boolean;
  coupons: StudioCoupon[];
  bundles: StudioBundle[];
  plans: StudioPlan[];
}

/** What a learner sees next to a course: bundles that include it and the school's passes. */
export interface CourseOffers {
  bundles: { id: string; title: string; priceUgx: number; courseCount: number }[];
  plans: { id: string; title: string; priceUgx: number; days: number }[];
}

export interface CohortInfo {
  id: string;
  name: string;
  startsAt: string;
  enrolUntil: string | null;
  seatsLeft: number | null;
}

export interface StudioCohort {
  id: string;
  name: string;
  startsAt: string;
  enrolUntil: string | null;
  capacity: number | null;
  members: number;
}

export interface CourseReview {
  userId?: string;
  name: string;
  rating: number;
  body: string;
  reply: string;
  createdAt: string;
}

export interface QaAnswer {
  id: string;
  by: string;
  byTeacher: boolean;
  body: string;
  createdAt: string;
  mine: boolean;
  canDelete: boolean;
}

export interface QaQuestion {
  id: string;
  lessonId: string | null;
  askedBy: string;
  /** The asker teaches this course (school owner or added teacher). */
  askedByTeacher?: boolean;
  body: string;
  createdAt: string;
  mine: boolean;
  canDelete: boolean;
  answers: QaAnswer[];
}

/** One post in Connect: a question or topic about a course (and optionally one of its lessons), with its replies. */
export interface ConnectTopic extends QaQuestion {
  courseId: string;
  courseTitle: string;
  schoolName: string;
  lessonTitle: string | null;
}

/** A course the person can talk in: one they have joined or teach. */
export interface ConnectCourse {
  id: string;
  title: string;
  schoolName: string;
  teaching: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

/** Everything the educator manages for a course beyond its content. */
export interface CourseCommunity {
  ready: boolean;
  owner: boolean;
  instructors: { userId: string; name: string }[];
  cohorts: StudioCohort[];
  reviews: (CourseReview & { userId: string })[];
  rating: { average: number | null; count: number };
  announcements: Announcement[];
  openQuestions: number;
}

export interface StudioLive {
  /** ISO time the lesson starts. */
  startsAt: string;
  durationMinutes: number;
  /** The meeting link. */
  url: string;
  notes: string;
}

export interface StudioSchool {
  id: string;
  name: string;
  slug: string;
  kind: SchoolKind;
  streams: EducationStream[];
  tagline: string;
  bio: string;
  location: string;
  motto: string;
  badge: string;
  contactEmail: string;
  contactPhone: string;
  status: SchoolStatus;
  createdAt: string;
  classCount: number;
  courseCount: number;
  publishedCourseCount: number;
  lessonCount: number;
}

export interface StudioClass {
  id: string;
  schoolId: string;
  stream: EducationStream;
  kind: ClassKind;
  name: string;
  level: string;
  framework: CurriculumFramework;
  academicYear: string;
  term: string;
  teacherName: string;
  capacity: number;
  summary: string;
  status: StudioStatus;
  courseCount: number;
}

export interface StudioCourse {
  id: string;
  schoolId: string;
  classId: string;
  stream: EducationStream;
  title: string;
  summary: string;
  priceUgx: number;
  framework: CurriculumFramework;
  outcomes: string[];
  status: StudioStatus;
  moduleCount: number;
  lessonCount: number;
  createdAt: string;
}

export interface StudioLesson {
  id: string;
  moduleId: string;
  courseId: string;
  title: string;
  contentType: LessonContentType;
  durationMinutes: number;
  summary: string;
  contentUrl: string;
  position: number;
  /** Text lessons: the written body. */
  body: string;
  /** Slide lessons. */
  slides: StudioSlide[];
  /** Live lessons. */
  live: StudioLive | null;
  /** Assignments. */
  assignment?: StudioAssignment | null;
  /** Quizzes and exams. */
  quiz: StudioQuiz | null;
  /** The uploaded video or audio, if any. */
  media: LessonMedia | null;
}

export interface StudioModule {
  /** Opens this many days after a learner enrols. 0 means straight away. */
  dripDays?: number;
  id: string;
  courseId: string;
  title: string;
  description: string;
  position: number;
  lessons: StudioLesson[];
}

export interface StudioCourseRules {
  /** Items must be finished in order. */
  sequential: boolean;
  /** A course the learner must finish before enrolling. */
  prerequisiteCourseId: string | null;
  /** Issue a certificate on completion. */
  certificateEnabled: boolean;
}

export interface StudioCourseDetail extends StudioCourse {
  modules: StudioModule[];
  rules: StudioCourseRules;
  /** Other courses in the same school that can be a prerequisite. */
  prerequisiteOptions: { id: string; title: string }[];
}

/** Every limit and switch the Learn Studio obeys. Set in Admin → Settings → Peebee Learn. */
export interface LearnSettings {
  /** Master switch for creating schools, classes and courses. */
  enabled: boolean;
  /** Streams educators may create content in right now. */
  streams: EducationStream[];
  /** Whether masterclasses (short open programmes) can be created next to ordinary classes. */
  masterclassesEnabled: boolean;
  /** Whether courses can carry a price. When off every course is free. */
  paidCoursesEnabled: boolean;
  maxCoursePriceUgx: number;
  maxSchoolsPerUser: number;
  maxClassesPerSchool: number;
  maxCoursesPerClass: number;
  maxModulesPerCourse: number;
  maxLessonsPerModule: number;
  maxQuizQuestionsPerLesson: number;
  /** Longest single lesson, in minutes. */
  maxLessonMinutes: number;
  /** Things one educator may create per hour (schools, classes, courses, modules and lessons together). */
  createsPerHour: number;
  /** A new course starts published. When off it starts as a draft and the educator publishes it. */
  publishByDefault: boolean;
  /** Learners can enrol in published courses. */
  enrolmentsEnabled: boolean;
  /** Peebee's share of every course sale and fee payment, in percent. */
  commissionPercent: number;
  /** Educators can attach a video or audio file to a lesson. */
  videoUploadsEnabled: boolean;
  /** Largest lesson video or audio file, in megabytes. */
  maxVideoMb: number;
  /** Largest cover picture for a school or course, in megabytes. 0 switches cover uploads off. */
  maxCoverMb: number;
  /** Quiz attempts one learner may make per hour. */
  quizAttemptsPerHour: number;
  /** Schools can issue fee invoices and learners can pay them. */
  feesEnabled: boolean;
  /** Pass mark for exams that are marked automatically, in percent. */
  examPassPercent: number;
  /** Educators can run live classroom sessions on a TV and students' phones. */
  liveEnabled: boolean;
  /** Most students in one live session. */
  liveMaxParticipants: number;
  /** How often a phone or TV asks for changes, in seconds. */
  livePollSeconds: number;
  /** Most items on one session's run sheet. */
  liveMaxCuesPerSession: number;
  /** Default time to answer a live question, in seconds. */
  liveQuestionSeconds: number;
  /** Longest a live exam may run, in minutes. */
  liveMaxExamMinutes: number;
  /** Most TV screens one educator can pair. */
  maxScreensPerUser: number;
  /** How long a TV's pairing code stays valid, in minutes. */
  screenPairMinutes: number;
  /** Two practice classes that run themselves, so anyone can try the live classroom with a code and no tutor. */
  trialClassesEnabled: boolean;
  /** The 6-digit codes that open the two trial classes. */
  trialCodeA: string;
  trialCodeB: string;
  /** Show the demo schools and courses in the catalogue next to real ones. */
  demoContentVisible: boolean;
  /** Learners can link a TV to their account and study courses, lessons and quizzes on it. */
  tvLearnEnabled: boolean;
  /** TV classroom is a Pro feature. Off (the default) means every educator can use it for free. */
  tvProRequired: boolean;
  /** What Learn Pro costs for one period, in UGX, taken from the educator's wallet. 0 makes it free to claim. */
  proPriceUgx: number;
  /** How many days one Pro purchase lasts. */
  proDays: number;
  /** Most slides in one slide lesson. */
  maxSlidesPerLesson: number;
  /** Longest text lesson, in characters. */
  maxLessonBodyChars: number;
  /** Attempts a learner gets at a quiz. 0 means unlimited. */
  quizMaxAttempts: number;
  /** Attempts a learner gets at an exam. 0 means unlimited. */
  examMaxAttempts: number;
  /** After a quiz, show which answers were right. */
  revealQuizAnswers: boolean;
  /** After an exam, show which answers were right. */
  revealExamAnswers: boolean;
  /** Educators can schedule live lessons with a Zoom, Meet, Jitsi or similar link. */
  liveLessonsEnabled: boolean;
  /** Hosts a live lesson link may point to, comma separated. Subdomains are allowed. */
  liveLessonHosts: string;
  /** How many minutes before the start a learner can open a live lesson. */
  liveLessonEarlyMinutes: number;
  /** Issue a certificate when a learner finishes a course. */
  certificatesEnabled: boolean;
  /** Award badges for milestones. */
  badgesEnabled: boolean;
  /** Educators can open sections some days after enrolment. */
  dripEnabled: boolean;
  /** Educators can require items in order, or another course first. */
  prerequisitesEnabled: boolean;
  /** Completed courses that earn the multi-course badge. */
  badgeCoursesThreshold: number;
  /** Educators can set assignments and mark what learners hand in. */
  assignmentsEnabled: boolean;
  /** Longest written answer to an assignment, in characters. */
  maxSubmissionChars: number;
  /** Educators can create coupon codes. */
  couponsEnabled: boolean;
  /** Largest percentage a coupon may take off, in percent. */
  maxCouponPercent: number;
  /** Educators can sell bundles of courses. */
  bundlesEnabled: boolean;
  /** Most courses in one bundle. */
  maxBundleCourses: number;
  /** Educators can sell school passes (access to every course for a time). */
  subscriptionsEnabled: boolean;
  /** Most passes one school can offer. */
  maxPlansPerSchool: number;
  /** Longest a pass can last, in days. */
  maxPlanDays: number;
  /** Learners can rate and review a course. */
  reviewsEnabled: boolean;
  /** Progress a learner needs before they can review, in percent. */
  reviewMinProgressPercent: number;
  /** Learners can ask questions on a course and lessons, and teachers answer. */
  qaEnabled: boolean;
  /** Longest question, answer or announcement, in characters. */
  maxQaChars: number;
  /** Questions and answers one person may post per hour. */
  qaPostsPerHour: number;
  /** Learners and parents can message a school, and its teachers reply. */
  messagingEnabled: boolean;
  /** Learners, parents and teachers can call each other from a school conversation. */
  callsEnabled: boolean;
  /** Longest message in a school conversation, in characters. */
  maxMessageChars: number;
  /** School messages one person may send per hour. */
  messagesPerHour: number;
  /** Educators can post announcements to a course. */
  announcementsEnabled: boolean;
  /** Educators can run cohorts: intakes with a start date and a seat limit. */
  cohortsEnabled: boolean;
  /** Educators can add other teachers to a course. */
  instructorsEnabled: boolean;
  /** Most extra teachers on one course. */
  maxInstructorsPerCourse: number;
  /** Learn home: the progress strip (badges and what to earn next). */
  homeProgressEnabled: boolean;
  /** Learn home: the tools grid (TV, certificates, fees, practice class). */
  homeToolsEnabled: boolean;
  /** Learn home: the "Free to start" row of courses. */
  homeFreeRailEnabled: boolean;
  /** Most courses in each row on the Learn home. */
  homeRailSize: number;
}

/** An educator's access to the TV classroom, and what Learn Pro costs. */
export interface LearnProStatus {
  ok: true;
  tv: {
    /** TV is a Pro feature right now. False means it is free for everyone. */
    required: boolean;
    /** This educator has Learn Pro. */
    pro: boolean;
    /** This educator may use the TV classroom. */
    allowed: boolean;
    expiresAt: string | null;
  };
  priceUgx: number;
  days: number;
}

/** One educator with Learn Pro, as staff see it. */
export interface LearnProEducator {
  userId: string;
  name: string;
  contact: string;
  source: string;
  expiresAt: string | null;
  active: boolean;
  pricePaidUgx: number;
  note: string;
}

/** What the admin sees about the demo content: whether it is installed and what it holds. */
export interface LearnDemoStatus {
  ok: true;
  steps: number;
  ready: boolean;
  /** Hand-applied migrations the demo still needs, if any. */
  missing: string[];
  installed: boolean;
  counts: { educators: number; schools: number; classes: number; courses: number; lessons: number; videos: number; trials: number };
  expected: { educators: number; schools: number; classes: number; courses: number; lessons: number; videos: number; trials: number };
}

/** A lesson's uploaded video or audio file. */
export interface LessonMedia {
  contentType: string;
  sizeBytes: number;
}

export const STUDIO_TEXT_LIMITS = {
  name: 120,
  short: 200,
  long: 2000,
  url: 500,
} as const;

/** What the Studio uses until Admin changes it. Mirrors the server defaults; the server's saved settings always win. */
export const DEFAULT_LEARN_SETTINGS: LearnSettings = {
  enabled: true,
  streams: ["sprouts", "foundations", "academy", "compass", "skills"],
  masterclassesEnabled: true,
  paidCoursesEnabled: true,
  maxCoursePriceUgx: 5_000_000,
  maxSchoolsPerUser: 3,
  maxClassesPerSchool: 30,
  maxCoursesPerClass: 12,
  maxModulesPerCourse: 30,
  maxLessonsPerModule: 40,
  maxQuizQuestionsPerLesson: 20,
  maxLessonMinutes: 240,
  createsPerHour: 60,
  publishByDefault: false,
  enrolmentsEnabled: true,
  commissionPercent: 10,
  videoUploadsEnabled: true,
  maxVideoMb: 50,
  maxCoverMb: 2,
  quizAttemptsPerHour: 30,
  feesEnabled: true,
  examPassPercent: 50,
  liveEnabled: true,
  liveMaxParticipants: 60,
  livePollSeconds: 3,
  liveMaxCuesPerSession: 100,
  liveQuestionSeconds: 30,
  liveMaxExamMinutes: 120,
  maxScreensPerUser: 5,
  screenPairMinutes: 10,
  trialClassesEnabled: true,
  trialCodeA: "111222",
  trialCodeB: "222111",
  demoContentVisible: true,
  tvLearnEnabled: true,
  tvProRequired: false,
  proPriceUgx: 50000,
  proDays: 30,
  maxSlidesPerLesson: 30,
  maxLessonBodyChars: 20000,
  quizMaxAttempts: 0,
  examMaxAttempts: 1,
  revealQuizAnswers: true,
  revealExamAnswers: false,
  liveLessonsEnabled: true,
  liveLessonHosts: "zoom.us,meet.google.com,meet.jit.si,teams.microsoft.com,whereby.com",
  liveLessonEarlyMinutes: 15,
  certificatesEnabled: true,
  badgesEnabled: true,
  dripEnabled: true,
  prerequisitesEnabled: true,
  badgeCoursesThreshold: 3,
  assignmentsEnabled: true,
  maxSubmissionChars: 5000,
  couponsEnabled: true,
  maxCouponPercent: 90,
  bundlesEnabled: true,
  maxBundleCourses: 20,
  subscriptionsEnabled: true,
  maxPlansPerSchool: 5,
  maxPlanDays: 365,
  reviewsEnabled: true,
  reviewMinProgressPercent: 25,
  qaEnabled: true,
  maxQaChars: 1500,
  qaPostsPerHour: 20,
  messagingEnabled: true,
  callsEnabled: true,
  maxMessageChars: 1000,
  messagesPerHour: 120,
  announcementsEnabled: true,
  cohortsEnabled: true,
  instructorsEnabled: true,
  maxInstructorsPerCourse: 5,
  homeProgressEnabled: true,
  homeToolsEnabled: true,
  homeFreeRailEnabled: true,
  homeRailSize: 8,
};

// ---------------------------------------------------------------------------
// School messaging: learners and parents talking to a school, and its teachers replying
// ---------------------------------------------------------------------------

export interface SchoolChatMessage {
  id: string;
  /** "customer" is the learner or parent, "school" is the school's teacher. */
  sender_role: "customer" | "school";
  body: string | null;
  /** "call" is a log line such as "Missed call". */
  type: "text" | "call";
  call_id: string | null;
  call_status: string | null;
  call_duration_seconds: number | null;
  read: number;
  created_at: string;
}

/** One school a learner or parent has written to. */
export interface SchoolChatThread {
  schoolId: string;
  schoolName: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  unread: boolean;
}

/** One person who has written to one of the teacher's schools. */
export interface StudioSchoolChatThread extends SchoolChatThread {
  customerId: string;
  customerName: string | null;
}

export interface SchoolChatConversation {
  messages: SchoolChatMessage[];
  /** Admin: calls from a conversation are on. */
  callsEnabled: boolean;
  maxMessageChars: number;
}

// ---------------------------------------------------------------------------
// Learning: enrolment, progress, grading and school fees
// ---------------------------------------------------------------------------

export interface LearnEnrollment {
  id: string;
  courseId: string;
  title: string;
  stream: EducationStream;
  schoolName: string;
  enrolledAt: string;
  lessonCount: number;
  completedLessons: number;
  progressPercent: number;
}

/** What a learner sees about a quiz or exam before starting it. */
export interface LearnerQuiz {
  title: string;
  passingScorePercent: number;
  questionCount: number;
  /** 0 means untimed. */
  timeLimitMinutes: number;
  /** 0 means unlimited. */
  attemptsAllowed: number;
  attemptsUsed: number;
}

export interface LearnerSubmission {
  body: string;
  link: string;
  status: "submitted" | "graded";
  score: number | null;
  feedback: string;
  submittedAt: string;
}

export interface LearnerAssignment {
  maxPoints: number;
  passPercent: number;
  dueAt: string | null;
  allowResubmit: boolean;
  /** Whether it can still be handed in. */
  open: boolean;
  submission: LearnerSubmission | null;
}

/** An assignment as the educator sees one learner's work. */
export interface StudioSubmission {
  id: string;
  userId: string;
  learnerName: string;
  body: string;
  link: string;
  status: "submitted" | "graded";
  score: number | null;
  feedback: string;
  submittedAt: string;
  gradedAt: string | null;
}

export interface GradebookItem {
  lessonId: string;
  title: string;
  contentType: LessonContentType;
}

export interface GradebookCell {
  lessonId: string;
  done: boolean;
  /** Percent, for quizzes, exams and graded assignments. */
  scorePercent: number | null;
  /** An assignment handed in and waiting to be marked. */
  needsMarking?: boolean;
}

export interface GradebookRow {
  userId: string;
  name: string;
  progressPercent: number;
  averagePercent: number | null;
  cells: GradebookCell[];
}

export interface Gradebook {
  items: GradebookItem[];
  rows: GradebookRow[];
}

export interface LearnerLive {
  startsAt: string;
  durationMinutes: number;
  /** Whether the join button is open now. */
  joinOpen: boolean;
  notes: string;
}

export interface LearnerLesson {
  id: string;
  title: string;
  contentType: LessonContentType;
  durationMinutes: number;
  summary: string;
  contentUrl: string;
  hasMedia: boolean;
  completed: boolean;
  bestScorePercent: number | null;
  slideCount: number;
  /** Set while the item can't be opened yet. */
  locked: { reason: "drip" | "sequence"; opensAt: string | null; message: string } | null;
  quiz: LearnerQuiz | null;
  live: LearnerLive | null;
  assignment?: LearnerAssignment | null;
}

/** One lesson in full, for the player. */
export interface LearnerLessonDetail extends LearnerLesson {
  body: string;
  slides: StudioSlide[];
}

export interface LearnerCourse {
  id: string;
  title: string;
  summary: string;
  stream: EducationStream;
  schoolName: string;
  /** The school behind the course, so a learner can message it. */
  schoolId?: string;
  progressPercent: number;
  /** The id of the certificate earned for this course, if any. */
  certificateId?: string | null;
  modules: { id: string; title: string; description: string; opensAt?: string | null; lessons: LearnerLesson[] }[];
}

export interface LearnerCertificate {
  id: string;
  code: string;
  courseId: string;
  courseTitle: string;
  schoolName: string;
  learnerName: string;
  scorePercent: number | null;
  issuedAt: string;
}

export interface LearnerBadge {
  key: string;
  title: string;
  description: string;
  icon: string;
  awardedAt: string | null;
}

/** A question as served to a learner: no answers. Positions in `options`/`right` are what answers refer to. */
export interface ServedQuestion {
  id: string;
  type: QuestionType;
  question: string;
  points: number;
  options?: string[];
  left?: string[];
  right?: string[];
}

export interface QuizAttemptStart {
  /** Send this back with the answers. */
  attemptToken: string;
  title: string;
  passMark: number;
  timeLimitMinutes: number;
  attemptsAllowed: number;
  attemptsUsed: number;
  questions: ServedQuestion[];
}

/** One answer: a position (single), positions (multiple, ordering, matching), true/false, or text. */
export type QuizAnswer = number | number[] | boolean | string | null;

export interface QuizResult {
  scorePercent: number;
  passed: boolean;
  passMark: number;
  earned: number;
  total: number;
  attemptsAllowed: number;
  attemptsUsed: number;
  /** answer and explanation are present only when the platform shows answers for this kind of paper. */
  results: { id: string; correct: boolean; earned: number; points: number; reveal?: { answer: string; explanation?: string } }[];
}

export interface FeeInvoice {
  id: string;
  schoolId: string;
  schoolName?: string;
  studentId: string;
  studentName?: string;
  title: string;
  amountUgx: number;
  paidUgx: number;
  balanceUgx: number;
  dueDate: string;
  status: "unpaid" | "partial" | "paid" | "cancelled";
  createdAt: string;
}

export interface CourseStudent {
  userId: string;
  name: string;
  enrolledAt: string;
  paidUgx: number;
  progressPercent: number;
}

// ---------------------------------------------------------------------------
// Live classroom: TV screens, sessions and what goes where
// ---------------------------------------------------------------------------

export type CueKind = "slide" | "lesson" | "announcement" | "timer" | "question" | "exam" | "attendance";
export type CueTarget = "screen" | "phones" | "both";

/** Where each kind of item makes sense. The educator may pick any of these when pushing. */
export const CUE_TARGETS: Record<CueKind, CueTarget[]> = {
  slide: ["screen", "both"],
  lesson: ["screen", "phones", "both"],
  announcement: ["screen", "phones", "both"],
  timer: ["screen", "both"],
  question: ["screen", "phones", "both"],
  exam: ["phones", "both"],
  attendance: ["phones", "both"],
};

export const CUE_LABELS: Record<CueKind, string> = {
  slide: "Slide",
  lesson: "Lesson",
  announcement: "Announcement",
  timer: "Timer",
  question: "Question or poll",
  exam: "Exam",
  attendance: "Attendance",
};

export interface TvDevice {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  sessionId: string | null;
  sessionTitle: string | null;
}

export interface LiveSessionSummary {
  id: string;
  title: string;
  code: string;
  status: "live" | "ended";
  schoolId: string;
  classId: string | null;
  courseId: string | null;
  screenDeviceId: string | null;
  createdAt: string;
}

export interface LiveQuestion {
  question: string;
  options: string[];
  correctIndex: number | null;
  explanation?: string;
}

export interface ConsoleCue {
  id: string;
  kind: CueKind;
  target: CueTarget;
  status: "queued" | "active" | "closed";
  revealed: boolean;
  endsAt: string | null;
  payload: Record<string, any>;
  responses: number;
  onScreen: boolean;
  onPhones: boolean;
  counts?: number[];
  lessonTitle?: string;
}

export interface ConsoleMember {
  userId: string;
  name: string;
  present: boolean;
  handRaised: boolean;
  points: number;
}

export interface ConsoleView {
  session: LiveSessionSummary & { version: number; playback: { playing: boolean; at?: number | null }; joinUrl: string };
  screen: { id: string; name: string; online: boolean } | null;
  cues: ConsoleCue[];
  members: ConsoleMember[];
  serverNow: string;
}

/** What a phone is shown. Never contains an answer until the tutor reveals it. */
export interface PhoneCue {
  id: string;
  kind: CueKind;
  endsAt: string | null;
  open: boolean;
  revealed: boolean;
  answered: boolean;
  title?: string;
  body?: string;
  imageUrl?: string | null;
  /** A lesson's video or audio, played on the phone. */
  media?: { url: string; contentType: string } | null;
  text?: string;
  label?: string;
  seconds?: number;
  question?: string;
  options?: string[];
  poll?: boolean;
  mine?: number | null;
  reveal?: { correctIndex: number | null; explanation: string; counts: number[]; correct: boolean | null };
  questions?: { question: string; options: string[] }[];
  result?: { score: number; outOf: number };
  review?: { correctIndex: number | null; explanation: string }[];
}

export type PhoneState =
  | { ok: true; changed: false; version: number }
  | { ok: true; changed: true; version: number; serverNow: string; status: "live" | "ended"; session: { title: string; hostName: string }; present: boolean; handRaised: boolean; cue: PhoneCue | null };

/** What the TV is shown. */
export interface ScreenCue {
  id: string;
  kind: CueKind;
  endsAt: string | null;
  open: boolean;
  revealed: boolean;
  title?: string;
  body?: string;
  imageUrl?: string | null;
  text?: string;
  label?: string;
  seconds?: number;
  media?: { url: string; contentType: string } | null;
  question?: string;
  options?: string[];
  poll?: boolean;
  answered?: number;
  total?: number;
  counts?: number[];
  correctIndex?: number | null;
  explanation?: string;
  leaders?: { name: string; points: number; outOf?: number }[];
  questionCount?: number;
  submitted?: number;
  average?: number | null;
  present?: number;
}

export interface ScreenState {
  ok: true;
  device: { name: string };
  pollSeconds: number;
  session: null | { id: string; title: string; code: string; joinUrl: string; participants: number; present: number; hands: number; /** A practice class that runs by itself. */ trial?: boolean };
  version?: number;
  serverNow?: string;
  playback?: { playing: boolean; at?: number | null; updatedAt?: string };
  cue?: ScreenCue | null;
}
