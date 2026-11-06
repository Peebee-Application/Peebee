import type {
  EducationStream,
  InstitutionProfile,
  SproutsActivity,
  SproutsScreenTimer,
  SproutsCoPlayPrompt,
  FoundationsWorksheet,
  FoundationsSubmission,
  FoundationsMeritWallet,
  AcademyTimetableDay,
  AcademyExam,
  AcademyTerminalReportCard,
  CompassCourseDetail,
  PeerReviewAssignment,
  CompassVerifiableCredential,
  SkillsCourseDetail,
  SkillsVideoSubmission,
  VideoTimestampCritique,
  ApprenticeLogbookEntry,
  TuitionInvoice,
  SubscriptionPass,
  GuardianAlertMessage,
  EducationLiveMeeting,
  LiveParticipant,
  TutorContact,
  LiveChatMessage,
} from "./education/types.js";
import type {
  ConsoleView,
  CueKind,
  CueTarget,
  LiveSessionSummary,
  PhoneState,
  TvDevice,
  CourseStudent,
  FeeInvoice,
  LearnEnrollment,
  LearnerCourse,
  QuizResult,
  QuizAnswer,
  QuizAttemptStart,
  LearnerLessonDetail,
  StudioLive,
  StudioCourseRules,
  SalesOverview,
  CohortInfo,
  CourseReview,
  QaQuestion,
  ConnectCourse,
  ConnectTopic,
  Announcement,
  CourseCommunity,
  StudioCohort,
  CourseOffers,
  StudioSubmission,
  StudioAssignment,
  Gradebook,
  LearnerCertificate,
  LearnerBadge,
  StudioSlide,
  LearnDemoStatus,
  LearnProEducator,
  LearnProStatus,
  LearnSettings,
  SchoolChatConversation,
  SchoolChatThread,
  StudioSchoolChatThread,
  SchoolKind,
  SchoolStatus,
  StudioClass,
  StudioCourse,
  StudioCourseDetail,
  StudioLesson,
  StudioModule,
  StudioQuiz,
  StudioSchool,
  StudioStatus,
  LessonContentType,
} from "./education/studio.js";
import type { ClassKind, CurriculumFramework } from "./education/types.js";

type RequestFn = <T>(path: string, options?: RequestInit) => Promise<T>;

export function educationMethods(request: RequestFn) {
  return {
    // ----------------------------------------------------
    // Streams & Institutions
    // ----------------------------------------------------
    async getEducationStreams() {
      return request<{ ok: true; streams: any[] }>("/v1/education/streams");
    },
    async getEducationInstitutions() {
      return request<{ ok: true; institutions: InstitutionProfile[] }>("/v1/education/institutions");
    },
    async getEducationInstitutionBySlug(slug: string) {
      return request<{ ok: true; institution: InstitutionProfile }>(`/v1/education/institutions/${encodeURIComponent(slug)}`);
    },

    // ----------------------------------------------------
    // 1. Sprouts (Ages 3-6)
    // ----------------------------------------------------
    async getSproutsActivities() {
      return request<{
        ok: true;
        activities: SproutsActivity[];
        screenTimer: SproutsScreenTimer;
        coPlayPrompt: SproutsCoPlayPrompt;
      }>("/v1/education/sprouts/activities");
    },
    async unlockSproutsScreenTimer(pin: string) {
      return request<{ ok: true; unlocked: boolean; message: string }>("/v1/education/sprouts/timer/unlock", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
    },

    // ----------------------------------------------------
    // 2. Foundations (Ages 6-12)
    // ----------------------------------------------------
    async getFoundationsWorksheets() {
      return request<{
        ok: true;
        worksheets: FoundationsWorksheet[];
        submissions: FoundationsSubmission[];
        meritWallet: FoundationsMeritWallet;
      }>("/v1/education/foundations/worksheets");
    },
    async submitFoundationsWorksheet(data: {
      worksheetId: string;
      scannedPhotoUrls: string[];
      parentPin: string;
      parentSignerName: string;
    }) {
      return request<{ ok: true; submission: FoundationsSubmission }>("/v1/education/foundations/worksheets/submit", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },

    // ----------------------------------------------------
    // 3. Academy (Ages 12-18)
    // ----------------------------------------------------
    async getAcademyDashboard() {
      return request<{
        ok: true;
        timetable: AcademyTimetableDay[];
        activeExam?: AcademyExam;
        reportCard: AcademyTerminalReportCard;
      }>("/v1/education/academy/dashboard");
    },
    async submitAcademyExam(data: {
      examId: string;
      answers: Record<string, string>;
      tabSwitchCount: number;
      focusLossEventsCount: number;
    }) {
      return request<{ ok: true; scorePercent: number | null; passed: boolean | null; status: "submitted" | "graded"; tabSwitchCount: number; message: string }>("/v1/education/academy/exam/submit", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },

    // ----------------------------------------------------
    // 4. Compass (Higher Ed & Business)
    // ----------------------------------------------------
    async getCompassCourse(courseId?: string) {
      const q = courseId ? `?id=${encodeURIComponent(courseId)}` : "";
      return request<{
        ok: true;
        course: CompassCourseDetail;
        peerReview: PeerReviewAssignment;
        credential: CompassVerifiableCredential;
      }>(`/v1/education/compass/course${q}`);
    },
    async saveVideoTimestampNote(data: {
      unitId: string;
      timestampSeconds: number;
      noteText: string;
    }) {
      return request<{ ok: true; noteId: string }>("/v1/education/compass/notes", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    async submitPeerReviewEvaluation(data: {
      assignmentId: string;
      anonymousSubmissionId: string;
      scores: { criteriaName: string; scoreAwarded: number; feedback: string }[];
    }) {
      return request<{ ok: true; isComplete: boolean }>("/v1/education/compass/peer-review/submit", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },

    // ----------------------------------------------------
    // 5. Skills (Vocational & Practical)
    // ----------------------------------------------------
    async getSkillsCourse(skillId?: string) {
      const q = skillId ? `?id=${encodeURIComponent(skillId)}` : "";
      return request<{
        ok: true;
        course: SkillsCourseDetail;
        submission: SkillsVideoSubmission;
        logbook: ApprenticeLogbookEntry[];
      }>(`/v1/education/skills/course${q}`);
    },
    async submitSkillsPracticalVideo(data: {
      trade: string;
      taskTitle: string;
      videoUrl: string;
      durationSeconds: number;
    }) {
      return request<{ ok: true; submission: SkillsVideoSubmission }>("/v1/education/skills/practical/submit", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    async addSkillsVideoCritique(data: {
      submissionId: string;
      timestampSeconds: number;
      instructorName: string;
      critiqueText: string;
      severity: "praise" | "technique_correction" | "safety_warning";
    }) {
      return request<{ ok: true; critique: VideoTimestampCritique }>("/v1/education/skills/critiques", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    async recordApprenticeHours(data: {
      date: string;
      practicalHours: number;
      taskPerformed: string;
      workshopLocation: string;
      supervisorName: string;
    }) {
      return request<{ ok: true; entry: ApprenticeLogbookEntry }>("/v1/education/skills/logbook", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },

    // ----------------------------------------------------
    // Tuition Invoicing & Passes
    // ----------------------------------------------------
    async getEducationTuitionInvoices() {
      return request<{
        ok: true;
        invoice: TuitionInvoice;
        passes: SubscriptionPass[];
        guardianAlerts: GuardianAlertMessage[];
      }>("/v1/education/tuition");
    },
    async payTuitionInstallment(data: {
      invoiceId: string;
      installmentNumber: number;
      amountUgx: number;
      paymentMethod: "wallet" | "momo_mtn" | "momo_airtel";
      phoneNumber?: string;
    }) {
      return request<{ ok: true; receiptId: string; newBalanceUgx: number }>("/v1/education/tuition/pay", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },

    // ----------------------------------------------------
    // Live Meetings & Classroom Video (Zoom-Style)
    // ----------------------------------------------------
    async getEducationLiveMeetings(stream?: EducationStream) {
      const q = stream ? `?stream=${encodeURIComponent(stream)}` : "";
      return request<{
        ok: true;
        meetings: EducationLiveMeeting[];
        activeMeeting?: EducationLiveMeeting;
      }>(`/v1/education/live/meetings${q}`);
    },
    async getEducationLiveMeetingById(meetingId: string) {
      return request<{
        ok: true;
        meeting: EducationLiveMeeting;
        participants: LiveParticipant[];
        messages: LiveChatMessage[];
      }>(`/v1/education/live/meetings/${encodeURIComponent(meetingId)}`);
    },

    // ----------------------------------------------------
    // Live Chat with Tutors & Classroom Channels
    // ----------------------------------------------------
    async getEducationTutors(stream?: EducationStream) {
      const q = stream ? `?stream=${encodeURIComponent(stream)}` : "";
      return request<{
        ok: true;
        tutors: TutorContact[];
      }>(`/v1/education/chat/tutors${q}`);
    },
    async getEducationChatMessages(roomIdOrContactId: string) {
      return request<{
        ok: true;
        messages: LiveChatMessage[];
      }>(`/v1/education/chat/messages?id=${encodeURIComponent(roomIdOrContactId)}`);
    },
    async sendEducationChatMessage(data: {
      roomId?: string;
      channelId?: string;
      recipientId?: string;
      text: string;
      senderRole: "tutor" | "student" | "parent";
      isQuestion?: boolean;
      attachmentUrl?: string;
      voiceDurationSecs?: number;
    }) {
      return request<{ ok: true; message: LiveChatMessage }>("/v1/education/chat/send", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },

    // ----------------------------------------------------
    // Catalogue: published studio courses (public, no quiz answers)
    // ----------------------------------------------------
    async getCatalogCourses(stream?: EducationStream) {
      const q = stream ? `?stream=${encodeURIComponent(stream)}` : "";
      return request<{
        ok: true;
        courses: {
          id: string; stream: EducationStream; title: string; summary: string; priceUgx: number; framework: CurriculumFramework; outcomes: string[];
          schoolId: string; schoolName: string; schoolSlug: string; className: string; classKind: ClassKind; classLevel: string; lessonCount: number;
          /** Sample content from the Peebee demo, not a real school. */
          demo: boolean;
        }[];
      }>(`/v1/education/catalog/courses${q}`);
    },
    async getCatalogHomeConfig() {
      return request<{
        ok: true;
        home: { progress: boolean; tools: boolean; freeRail: boolean; railSize: number; tv: boolean; certificates: boolean; fees: boolean; live: boolean; trialClasses: boolean };
      }>("/v1/education/catalog/home-config");
    },
    async getCatalogCourse(id: string) {
      return request<{
        ok: true;
        course: {
          id: string; stream: EducationStream; title: string; summary: string; priceUgx: number; framework: CurriculumFramework; outcomes: string[];
          schoolId?: string; schoolName: string; className: string;
          prerequisite?: { id: string; title: string } | null;
          rating?: { average: number | null; count: number };
          reviews?: CourseReview[];
          cohorts?: CohortInfo[];
          bundles?: CourseOffers["bundles"];
          plans?: CourseOffers["plans"];
          modules: { id: string; title: string; description: string; lessons: { id: string; title: string; contentType: LessonContentType; durationMinutes: number; summary: string; questionCount: number }[] }[];
        };
      }>(`/v1/education/catalog/courses/${encodeURIComponent(id)}`);
    },

    // ----------------------------------------------------
    // Studio: school → class → course → module → lesson (all scoped to the signed-in educator)
    // ----------------------------------------------------
    // ----------------------------------------------------
    // School messages (learner or parent side, and teacher side). Calls reuse /v1/calls with a schoolId.
    // ----------------------------------------------------
    async schoolChat(schoolId: string) {
      return request<{ ok: true; schoolName: string; schoolOwnerId: string } & SchoolChatConversation>(`/v1/education/messages/schools/${encodeURIComponent(schoolId)}`);
    },
    async sendSchoolChat(schoolId: string, body: string) {
      return request<{ ok: true; id: string }>(`/v1/education/messages/schools/${encodeURIComponent(schoolId)}`, { method: "POST", body: JSON.stringify({ body }) });
    },
    async markSchoolChatRead(schoolId: string) {
      return request<{ ok: true }>(`/v1/education/messages/schools/${encodeURIComponent(schoolId)}/read`, { method: "POST", body: "{}" });
    },
    async mySchoolChats() {
      return request<{ ok: true; threads: SchoolChatThread[] }>("/v1/education/messages/mine");
    },
    async studioSchoolChats() {
      return request<{ ok: true; threads: StudioSchoolChatThread[] }>("/v1/education/messages/studio");
    },
    async studioSchoolChat(schoolId: string, customerId: string) {
      return request<{ ok: true; schoolName: string; customerName: string | null } & SchoolChatConversation>(`/v1/education/messages/studio/${encodeURIComponent(schoolId)}/${encodeURIComponent(customerId)}`);
    },
    async replySchoolChat(schoolId: string, customerId: string, body: string) {
      return request<{ ok: true; id: string }>(`/v1/education/messages/studio/${encodeURIComponent(schoolId)}/${encodeURIComponent(customerId)}`, { method: "POST", body: JSON.stringify({ body }) });
    },
    async markStudioSchoolChatRead(schoolId: string, customerId: string) {
      return request<{ ok: true }>(`/v1/education/messages/studio/${encodeURIComponent(schoolId)}/${encodeURIComponent(customerId)}/read`, { method: "POST", body: "{}" });
    },
    async studioConfig() {
      return request<{ ok: true; settings: LearnSettings; usage: { schools: number } }>("/v1/education/studio/config");
    },
    async studioSchools() {
      return request<{ ok: true; schools: StudioSchool[] }>("/v1/education/studio/schools");
    },
    async studioSchool(id: string) {
      return request<{ ok: true; school: StudioSchool }>(`/v1/education/studio/schools/${encodeURIComponent(id)}`);
    },
    async studioCreateSchool(data: {
      name: string;
      kind: SchoolKind;
      streams: EducationStream[];
      tagline?: string;
      bio?: string;
      location?: string;
      motto?: string;
      badge?: string;
      contactEmail?: string;
      contactPhone?: string;
    }) {
      return request<{ ok: true; school: StudioSchool }>("/v1/education/studio/schools", { method: "POST", body: JSON.stringify(data) });
    },
    async studioUpdateSchool(id: string, data: Partial<Omit<StudioSchool, "id" | "slug" | "status" | "createdAt" | "classCount" | "courseCount">>) {
      return request<{ ok: true; school: StudioSchool }>(`/v1/education/studio/schools/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
    },
    async studioDeleteSchool(id: string) {
      return request<{ ok: true }>(`/v1/education/studio/schools/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async studioClasses(schoolId: string) {
      return request<{ ok: true; classes: StudioClass[] }>(`/v1/education/studio/schools/${encodeURIComponent(schoolId)}/classes`);
    },
    async studioCreateClass(
      schoolId: string,
      data: {
        stream: EducationStream;
        kind: ClassKind;
        name: string;
        level: string;
        framework: CurriculumFramework;
        academicYear?: string;
        term?: string;
        teacherName?: string;
        capacity?: number;
        summary?: string;
      },
    ) {
      return request<{ ok: true; class: StudioClass }>(`/v1/education/studio/schools/${encodeURIComponent(schoolId)}/classes`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    async studioClass(id: string) {
      return request<{ ok: true; class: StudioClass }>(`/v1/education/studio/classes/${encodeURIComponent(id)}`);
    },
    async studioUpdateClass(id: string, data: Partial<Omit<StudioClass, "id" | "schoolId" | "courseCount">>) {
      return request<{ ok: true; class: StudioClass }>(`/v1/education/studio/classes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
    },
    async studioDeleteClass(id: string) {
      return request<{ ok: true }>(`/v1/education/studio/classes/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async studioCourses(classId: string) {
      return request<{ ok: true; courses: StudioCourse[] }>(`/v1/education/studio/classes/${encodeURIComponent(classId)}/courses`);
    },
    async studioCreateCourse(
      classId: string,
      data: { title: string; summary?: string; priceUgx?: number; framework?: CurriculumFramework; outcomes?: string[] },
    ) {
      return request<{ ok: true; course: StudioCourse }>(`/v1/education/studio/classes/${encodeURIComponent(classId)}/courses`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    async studioCourse(id: string) {
      return request<{ ok: true; course: StudioCourseDetail }>(`/v1/education/studio/courses/${encodeURIComponent(id)}`);
    },
    async studioUpdateCourse(
      id: string,
      data: { title?: string; summary?: string; priceUgx?: number; framework?: CurriculumFramework; outcomes?: string[]; status?: StudioStatus },
    ) {
      return request<{ ok: true; course: StudioCourse }>(`/v1/education/studio/courses/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
    },
    async studioDeleteCourse(id: string) {
      return request<{ ok: true }>(`/v1/education/studio/courses/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async studioCreateModule(courseId: string, data: { title: string; description?: string }) {
      return request<{ ok: true; module: StudioModule }>(`/v1/education/studio/courses/${encodeURIComponent(courseId)}/modules`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    async studioUpdateModule(id: string, data: { title?: string; description?: string }) {
      return request<{ ok: true; module: StudioModule }>(`/v1/education/studio/modules/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
    },
    async studioDeleteModule(id: string) {
      return request<{ ok: true }>(`/v1/education/studio/modules/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async studioCreateLesson(
      moduleId: string,
      data: {
        title: string;
        contentType?: LessonContentType;
        durationMinutes?: number;
        summary?: string;
        contentUrl?: string;
        body?: string;
        slides?: StudioSlide[];
        live?: StudioLive | null;
        assignment?: StudioAssignment | null;
        quiz?: StudioQuiz | null;
      },
    ) {
      return request<{ ok: true; lesson: StudioLesson }>(`/v1/education/studio/modules/${encodeURIComponent(moduleId)}/lessons`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    async studioUpdateLesson(
      id: string,
      data: {
        title?: string;
        contentType?: LessonContentType;
        durationMinutes?: number;
        summary?: string;
        contentUrl?: string;
        body?: string;
        slides?: StudioSlide[];
        live?: StudioLive | null;
        assignment?: StudioAssignment | null;
        quiz?: StudioQuiz | null;
      },
    ) {
      return request<{ ok: true; lesson: StudioLesson }>(`/v1/education/studio/lessons/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
    },
    /** Saves the running order of a whole course: section order, and which items sit in which section. */
    async studioReorderCourse(courseId: string, order: { modules: string[]; lessons: Record<string, string[]> }) {
      return request<{ ok: true }>(`/v1/education/studio/courses/${encodeURIComponent(courseId)}/order`, { method: "POST", body: JSON.stringify(order) });
    },
    async studioSetCourseRules(courseId: string, rules: StudioCourseRules) {
      return request<{ ok: true; rules: StudioCourseRules }>(`/v1/education/studio/courses/${encodeURIComponent(courseId)}/rules`, { method: "PUT", body: JSON.stringify(rules) });
    },
    async studioSetModuleDrip(moduleId: string, days: number) {
      return request<{ ok: true; days: number }>(`/v1/education/studio/modules/${encodeURIComponent(moduleId)}/drip`, { method: "PUT", body: JSON.stringify({ days }) });
    },
    async studioSubmissions(lessonId: string) {
      return request<{ ok: true; assignment: StudioAssignment | null; submissions: StudioSubmission[] }>(`/v1/education/studio/lessons/${encodeURIComponent(lessonId)}/submissions`);
    },
    async studioGradeSubmission(id: string, score: number, feedback: string) {
      return request<{ ok: true; percent: number; passed: boolean }>(`/v1/education/studio/submissions/${encodeURIComponent(id)}/grade`, { method: "PUT", body: JSON.stringify({ score, feedback }) });
    },
    async studioGradebook(courseId: string) {
      return request<{ ok: true; gradebook: Gradebook }>(`/v1/education/studio/courses/${encodeURIComponent(courseId)}/gradebook`);
    },
    async studioLessonAttendance(lessonId: string) {
      return request<{ ok: true; enrolled: number; attendees: { userId: string; name: string; joinedAt: string }[] }>(`/v1/education/studio/lessons/${encodeURIComponent(lessonId)}/attendance`);
    },
    async studioDeleteLesson(id: string) {
      return request<{ ok: true }>(`/v1/education/studio/lessons/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    async studioDeleteLessonMedia(lessonId: string) {
      return request<{ ok: true }>(`/v1/education/studio/lessons/${encodeURIComponent(lessonId)}/media`, { method: "DELETE" });
    },
    async studioCourseStudents(courseId: string) {
      return request<{ ok: true; students: CourseStudent[] }>(`/v1/education/studio/courses/${encodeURIComponent(courseId)}/students`);
    },
    async studioInvoices(schoolId: string) {
      return request<{ ok: true; invoices: FeeInvoice[] }>(`/v1/education/studio/schools/${encodeURIComponent(schoolId)}/invoices`);
    },
    async studioCreateInvoice(schoolId: string, data: { student: string; title: string; amountUgx: number; dueDate?: string }) {
      return request<{ ok: true; invoice: FeeInvoice }>(`/v1/education/studio/schools/${encodeURIComponent(schoolId)}/invoices`, { method: "POST", body: JSON.stringify(data) });
    },
    async studioCancelInvoice(id: string) {
      return request<{ ok: true }>(`/v1/education/studio/invoices/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({}) });
    },

    // ----------------------------------------------------
    // Learner: enrolment, lessons, quizzes and fees
    // ----------------------------------------------------
    async learnEnrollments() {
      return request<{ ok: true; enrollments: LearnEnrollment[] }>("/v1/education/learn/enrollments");
    },
    async learnEnroll(courseId: string, options: string | { coupon?: string; cohortId?: string } = {}) {
      const body = typeof options === "string" ? { coupon: options } : options;
      return request<{ ok: true; enrolled: true; paidUgx: number; viaPass?: boolean }>(`/v1/education/learn/courses/${encodeURIComponent(courseId)}/enroll`, { method: "POST", body: JSON.stringify(body) });
    },
    async learnQuote(courseId: string, coupon: string) {
      return request<{ ok: true; valid: boolean; message?: string; priceUgx: number; discountUgx: number; finalUgx: number }>(`/v1/education/learn/courses/${encodeURIComponent(courseId)}/quote`, { method: "POST", body: JSON.stringify({ coupon }) });
    },
    async learnBuyBundle(id: string) {
      return request<{ ok: true; enrolledIn: number; paidUgx: number }>(`/v1/education/learn/bundles/${encodeURIComponent(id)}/buy`, { method: "POST", body: JSON.stringify({}) });
    },
    async learnSubscribe(planId: string) {
      return request<{ ok: true; expiresAt: string | null; paidUgx: number }>(`/v1/education/learn/plans/${encodeURIComponent(planId)}/subscribe`, { method: "POST", body: JSON.stringify({}) });
    },
    async learnSubscriptions() {
      return request<{ ok: true; subscriptions: { id: string; title: string; schoolId: string; schoolName: string; expiresAt: string }[] }>("/v1/education/learn/subscriptions");
    },
    async learnMyReview(courseId: string) {
      return request<{ ok: true; review: { rating: number; body: string; reply: string } | null }>(`/v1/education/learn/courses/${encodeURIComponent(courseId)}/review`);
    },
    async learnSaveReview(courseId: string, rating: number, body: string) {
      return request<{ ok: true }>(`/v1/education/learn/courses/${encodeURIComponent(courseId)}/review`, { method: "POST", body: JSON.stringify({ rating, body }) });
    },
    async learnConnect(courseId?: string) {
      return request<{ ok: true; enabled: boolean; courses: ConnectCourse[]; topics: ConnectTopic[] }>(`/v1/education/learn/connect${courseId ? `?course=${encodeURIComponent(courseId)}` : ""}`);
    },
    async learnQa(courseId: string, lessonId?: string) {
      return request<{ ok: true; questions: QaQuestion[] }>(`/v1/education/learn/courses/${encodeURIComponent(courseId)}/qa${lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : ""}`);
    },
    async learnAsk(courseId: string, body: string, lessonId: string | null) {
      return request<{ ok: true; id: string }>(`/v1/education/learn/courses/${encodeURIComponent(courseId)}/qa`, { method: "POST", body: JSON.stringify({ body, lessonId }) });
    },
    async learnAnswer(questionId: string, body: string) {
      return request<{ ok: true; id: string }>(`/v1/education/learn/qa/${encodeURIComponent(questionId)}/answers`, { method: "POST", body: JSON.stringify({ body }) });
    },
    async learnDeleteQuestion(id: string) {
      return request<{ ok: true }>(`/v1/education/learn/qa/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async learnDeleteAnswer(id: string) {
      return request<{ ok: true }>(`/v1/education/learn/qa/answers/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async learnAnnouncements(courseId: string) {
      return request<{ ok: true; announcements: Announcement[] }>(`/v1/education/learn/courses/${encodeURIComponent(courseId)}/announcements`);
    },
    async studioCommunity(courseId: string) {
      return request<{ ok: true } & CourseCommunity>(`/v1/education/studio/courses/${encodeURIComponent(courseId)}/community`);
    },
    async studioAddInstructor(courseId: string, identifier: string) {
      return request<{ ok: true; userId: string; name: string }>(`/v1/education/studio/courses/${encodeURIComponent(courseId)}/instructors`, { method: "POST", body: JSON.stringify({ identifier }) });
    },
    async studioRemoveInstructor(courseId: string, userId: string) {
      return request<{ ok: true }>(`/v1/education/studio/courses/${encodeURIComponent(courseId)}/instructors/${encodeURIComponent(userId)}`, { method: "DELETE" });
    },
    async studioSaveCohort(courseId: string, id: string | null, data: { name: string; startsAt: string; enrolUntil: string | null; capacity: number | null }) {
      return id
        ? request<{ ok: true }>(`/v1/education/studio/cohorts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) })
        : request<{ ok: true; id: string }>(`/v1/education/studio/courses/${encodeURIComponent(courseId)}/cohorts`, { method: "POST", body: JSON.stringify(data) });
    },
    async studioDeleteCohort(id: string) {
      return request<{ ok: true }>(`/v1/education/studio/cohorts/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async studioReplyReview(courseId: string, userId: string, reply: string) {
      return request<{ ok: true }>(`/v1/education/studio/courses/${encodeURIComponent(courseId)}/reviews/${encodeURIComponent(userId)}/reply`, { method: "PUT", body: JSON.stringify({ reply }) });
    },
    async studioPostAnnouncement(courseId: string, title: string, body: string) {
      return request<{ ok: true; id: string }>(`/v1/education/studio/courses/${encodeURIComponent(courseId)}/announcements`, { method: "POST", body: JSON.stringify({ title, body }) });
    },
    async studioDeleteAnnouncement(id: string) {
      return request<{ ok: true }>(`/v1/education/studio/announcements/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async studioSharedCourses() {
      return request<{ ok: true; courses: { id: string; title: string; stream: string; status: string; schoolName: string }[] }>("/v1/education/studio/shared-courses");
    },
    async studioSales(schoolId: string) {
      return request<{ ok: true } & SalesOverview>(`/v1/education/studio/schools/${encodeURIComponent(schoolId)}/sales`);
    },
    async studioCreateCoupon(schoolId: string, data: { code: string; percentOff: number | null; amountOffUgx: number | null; courseId: string | null; maxUses: number | null; expiresAt: string | null }) {
      return request<{ ok: true; id: string }>(`/v1/education/studio/schools/${encodeURIComponent(schoolId)}/coupons`, { method: "POST", body: JSON.stringify(data) });
    },
    async studioSetCouponActive(id: string, active: boolean) {
      return request<{ ok: true }>(`/v1/education/studio/coupons/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ active }) });
    },
    async studioDeleteCoupon(id: string) {
      return request<{ ok: true }>(`/v1/education/studio/coupons/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async studioSaveBundle(schoolId: string, id: string | null, data: { title: string; summary: string; priceUgx: number; courseIds: string[]; status: "draft" | "published" }) {
      return id
        ? request<{ ok: true }>(`/v1/education/studio/bundles/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) })
        : request<{ ok: true; id: string }>(`/v1/education/studio/schools/${encodeURIComponent(schoolId)}/bundles`, { method: "POST", body: JSON.stringify(data) });
    },
    async studioDeleteBundle(id: string) {
      return request<{ ok: true }>(`/v1/education/studio/bundles/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async studioSavePlan(schoolId: string, id: string | null, data: { title: string; summary: string; priceUgx: number; days: number; status: "draft" | "published" }) {
      return id
        ? request<{ ok: true }>(`/v1/education/studio/plans/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) })
        : request<{ ok: true; id: string }>(`/v1/education/studio/schools/${encodeURIComponent(schoolId)}/plans`, { method: "POST", body: JSON.stringify(data) });
    },
    async studioDeletePlan(id: string) {
      return request<{ ok: true }>(`/v1/education/studio/plans/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async learnCourse(courseId: string) {
      return request<{ ok: true; owner: boolean; course: LearnerCourse }>(`/v1/education/learn/courses/${encodeURIComponent(courseId)}`);
    },
    async learnLessonMediaUrl(lessonId: string) {
      return request<{ ok: true; url: string }>(`/v1/education/learn/lessons/${encodeURIComponent(lessonId)}/media-url`, { method: "POST", body: JSON.stringify({}) });
    },
    async learnSubmitWork(lessonId: string, work: { body: string; link: string }) {
      return request<{ ok: true }>(`/v1/education/learn/lessons/${encodeURIComponent(lessonId)}/submission`, { method: "POST", body: JSON.stringify(work) });
    },
    async learnCertificates() {
      return request<{ ok: true; certificates: LearnerCertificate[] }>("/v1/education/learn/certificates");
    },
    async learnCertificate(id: string) {
      return request<{ ok: true; certificate: LearnerCertificate }>(`/v1/education/learn/certificates/${encodeURIComponent(id)}`);
    },
    async learnBadges() {
      return request<{ ok: true; enabled: boolean; badges: LearnerBadge[] }>("/v1/education/learn/badges");
    },
    /** Anyone can check a certificate by its code. */
    async verifyCertificate(code: string) {
      return request<{ ok: true; certificate: { learnerName: string; courseTitle: string; schoolName: string; scorePercent: number | null; issuedAt: string } }>(`/v1/education/catalog/certificates/${encodeURIComponent(code)}`);
    },
    async learnLesson(lessonId: string) {
      return request<{ ok: true; lesson: LearnerLessonDetail }>(`/v1/education/learn/lessons/${encodeURIComponent(lessonId)}`);
    },
    async learnStartQuiz(lessonId: string) {
      return request<{ ok: true } & QuizAttemptStart>(`/v1/education/learn/lessons/${encodeURIComponent(lessonId)}/quiz/start`, { method: "POST", body: JSON.stringify({}) });
    },
    async learnSubmitAttempt(lessonId: string, attemptToken: string, answers: Record<string, QuizAnswer>) {
      return request<{ ok: true } & QuizResult>(`/v1/education/learn/lessons/${encodeURIComponent(lessonId)}/quiz/submit`, { method: "POST", body: JSON.stringify({ attemptToken, answers }) });
    },
    /** Opens a live lesson: returns the meeting link and marks the learner as attending. */
    async learnJoinLive(lessonId: string) {
      return request<{ ok: true; url: string }>(`/v1/education/learn/lessons/${encodeURIComponent(lessonId)}/join`, { method: "POST", body: JSON.stringify({}) });
    },
    async learnSubmitQuiz(lessonId: string, answers: number[]) {
      // The first version of the quiz call. Kept for apps that haven't moved to learnStartQuiz.
      return request<{ ok: true } & QuizResult>(`/v1/education/learn/lessons/${encodeURIComponent(lessonId)}/quiz`, { method: "POST", body: JSON.stringify({ answers }) });
    },
    async learnCompleteLesson(lessonId: string) {
      return request<{ ok: true }>(`/v1/education/learn/lessons/${encodeURIComponent(lessonId)}/complete`, { method: "POST", body: JSON.stringify({}) });
    },
    async learnInvoices() {
      return request<{ ok: true; invoices: FeeInvoice[] }>("/v1/education/learn/invoices");
    },
    async learnPayInvoice(id: string, amountUgx: number) {
      return request<{ ok: true; receiptId: string; invoice: FeeInvoice }>(`/v1/education/learn/invoices/${encodeURIComponent(id)}/pay`, { method: "POST", body: JSON.stringify({ amountUgx }) });
    },

    // ----------------------------------------------------
    // TV screens
    // ----------------------------------------------------
    async tvDevices() {
      return request<{ ok: true; devices: TvDevice[] }>("/v1/tv/devices");
    },
    /** `purpose` "learn" links a TV for studying on it (free for everyone); the default, "teach", is a classroom screen for educators. */
    async tvPair(code: string, name?: string, purpose?: "learn" | "teach") {
      return request<{ ok: true; device: { id: string; name: string } }>("/v1/tv/pair", { method: "POST", body: JSON.stringify({ code, name: name ?? "", ...(purpose ? { purpose } : {}) }) });
    },
    async tvRename(id: string, name: string) {
      return request<{ ok: true }>(`/v1/tv/devices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) });
    },
    async tvRemove(id: string) {
      return request<{ ok: true }>(`/v1/tv/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    // ----------------------------------------------------
    // Live classroom: the educator's console
    // ----------------------------------------------------
    async classroomSessions() {
      return request<{ ok: true; sessions: LiveSessionSummary[] }>("/v1/education/classroom/sessions");
    },
    async classroomCreate(data: { title: string; courseId?: string; classId?: string; schoolId?: string; screenDeviceId?: string | null; autoCues?: boolean }) {
      return request<{ ok: true; session: LiveSessionSummary }>("/v1/education/classroom/sessions", { method: "POST", body: JSON.stringify(data) });
    },
    async classroomConsole(id: string) {
      return request<{ ok: true } & ConsoleView>(`/v1/education/classroom/sessions/${encodeURIComponent(id)}`);
    },
    async classroomUpdate(id: string, data: { title?: string; screenDeviceId?: string | null }) {
      return request<{ ok: true }>(`/v1/education/classroom/sessions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
    },
    async classroomEnd(id: string) {
      return request<{ ok: true }>(`/v1/education/classroom/sessions/${encodeURIComponent(id)}/end`, { method: "POST", body: JSON.stringify({}) });
    },
    async classroomAddCue(id: string, data: { kind: CueKind; target?: CueTarget; payload: Record<string, unknown> }) {
      return request<{ ok: true; cueId: string }>(`/v1/education/classroom/sessions/${encodeURIComponent(id)}/cues`, { method: "POST", body: JSON.stringify(data) });
    },
    async classroomDeleteCue(cueId: string) {
      return request<{ ok: true }>(`/v1/education/classroom/cues/${encodeURIComponent(cueId)}`, { method: "DELETE" });
    },
    async classroomPush(cueId: string, target?: CueTarget) {
      return request<{ ok: true; target: CueTarget; endsAt: string | null }>(`/v1/education/classroom/cues/${encodeURIComponent(cueId)}/push`, { method: "POST", body: JSON.stringify({ target }) });
    },
    async classroomReveal(cueId: string) {
      return request<{ ok: true }>(`/v1/education/classroom/cues/${encodeURIComponent(cueId)}/reveal`, { method: "POST", body: JSON.stringify({}) });
    },
    async classroomCloseCue(cueId: string) {
      return request<{ ok: true }>(`/v1/education/classroom/cues/${encodeURIComponent(cueId)}/close`, { method: "POST", body: JSON.stringify({}) });
    },
    async classroomClear(id: string, channel: CueTarget) {
      return request<{ ok: true }>(`/v1/education/classroom/sessions/${encodeURIComponent(id)}/clear`, { method: "POST", body: JSON.stringify({ channel }) });
    },
    async classroomPlayback(id: string, playing: boolean, at?: number) {
      return request<{ ok: true }>(`/v1/education/classroom/sessions/${encodeURIComponent(id)}/playback`, { method: "POST", body: JSON.stringify({ playing, at }) });
    },
    async classroomLowerHand(id: string, userId: string) {
      return request<{ ok: true }>(`/v1/education/classroom/sessions/${encodeURIComponent(id)}/hands/${encodeURIComponent(userId)}/clear`, { method: "POST", body: JSON.stringify({}) });
    },

    // ----------------------------------------------------
    // Live classroom: the student's phone
    // ----------------------------------------------------
    /** The practice classes anyone can try with a code. Empty when they are switched off. */
    async proStatus() {
      return request<LearnProStatus>("/v1/education/pro");
    },
    /** Buys a period of Learn Pro from the wallet. Only offered when TV is a Pro feature. */
    async proSubscribe() {
      return request<{ ok: true; expiresAt: string; priceUgx: number }>("/v1/education/pro/subscribe", { method: "POST", body: "{}" });
    },
    async classroomTrial() {
      return request<{ ok: true; classes: { code: string; title: string; hostName: string; stream: EducationStream | null }[] }>("/v1/education/classroom/trial");
    },
    async classroomJoin(code: string) {
      return request<{ ok: true; session: { id: string; title: string; hostName: string; pollSeconds: number } }>("/v1/education/classroom/join", { method: "POST", body: JSON.stringify({ code }) });
    },
    async classroomState(id: string, since?: number) {
      return request<PhoneState>(`/v1/education/classroom/sessions/${encodeURIComponent(id)}/state${since ? `?since=${since}` : ""}`);
    },
    async classroomRespond(id: string, cueId: string, answers: number[]) {
      return request<{ ok: true; accepted: true }>(`/v1/education/classroom/sessions/${encodeURIComponent(id)}/respond`, { method: "POST", body: JSON.stringify({ cueId, answers }) });
    },
    async classroomHand(id: string, raised: boolean) {
      return request<{ ok: true }>(`/v1/education/classroom/sessions/${encodeURIComponent(id)}/hand`, { method: "POST", body: JSON.stringify({ raised }) });
    },

    // ----------------------------------------------------
    // Admin (staff only)
    // ----------------------------------------------------
    async adminGetLearnSettings() {
      return request<{ learn: LearnSettings }>("/v1/admin/learn-settings");
    },
    async adminUpdateLearnSettings(learn: Partial<LearnSettings>) {
      return request<{ learn: LearnSettings }>("/v1/admin/learn-settings", { method: "PATCH", body: JSON.stringify(learn) });
    },
    async adminDemoStatus() {
      return request<LearnDemoStatus>("/v1/admin/learn-demo");
    },
    /** Installs one step of the demo content; call for step 0 up to steps - 1. A password is optional and lets the demo educators sign in. */
    async adminDemoInstall(step: number, password?: string) {
      return request<{ ok: true; step: number; total: number; label: string; done: boolean }>("/v1/admin/learn-demo/install", {
        method: "POST",
        body: JSON.stringify({ step, ...(password ? { password } : {}) }),
      });
    },
    async adminDemoRemove() {
      return request<{ ok: true; schools: number; accountsRemoved: number; accountsKept: number }>("/v1/admin/learn-demo", { method: "DELETE" });
    },
    async adminProList() {
      return request<{ ok: true; educators: LearnProEducator[] }>("/v1/admin/learn-pro");
    },
    async adminProGrant(identifier: string, days: number | null, note?: string) {
      return request<{ ok: true; userId: string; name: string; expiresAt: string | null }>("/v1/admin/learn-pro/grant", {
        method: "POST",
        body: JSON.stringify({ identifier, days, ...(note ? { note } : {}) }),
      });
    },
    async adminProRevoke(userId: string) {
      return request<{ ok: true }>(`/v1/admin/learn-pro/${encodeURIComponent(userId)}`, { method: "DELETE" });
    },
    async adminLearnSchools() {
      return request<{ ok: true; schools: (StudioSchool & { ownerName: string; ownerId: string })[] }>("/v1/admin/learn-schools");
    },
    async adminSetLearnSchoolStatus(id: string, status: SchoolStatus) {
      return request<{ ok: true; status: SchoolStatus }>(`/v1/admin/learn-schools/${encodeURIComponent(id)}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    },
  };
}
