/** Shared authoring contract used by learners, Learn Studio and Merchant Elite. */
export type LearningObjective = {
  id: string;
  title: string;
  evidence: string;
  source: string;
};
export type LearningResource = {
  id: string;
  title: string;
  kind: "video" | "image" | "gif" | "pdf" | "document" | "audio" | "link";
  url: string;
  description: string;
  transcript: string;
  tutorAllowed: boolean;
};
export type LearningQuestion = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  objectiveId: string;
};
export type LearningLesson = {
  id: string;
  title: string;
  body: string;
  minutes: number;
  objectiveIds: string[];
  resources: LearningResource[];
  questions: LearningQuestion[];
  nativeActivity?: boolean;
  teacherNotes?: string;
  locked?: boolean;
  lockMessage?: string;
};
export type LearningModule = {
  id: string;
  title: string;
  description: string;
  lessons: LearningLesson[];
};
export type LearningDraft = {
  title: string;
  summary: string;
  kind: "course" | "path";
  language: string;
  audience: string;
  goal: string;
  timeBudget?: string;
  curriculum: string;
  sourceText: string;
  priceUgx: number;
  visibility: "private" | "invite" | "unlisted" | "public";
  objectives: LearningObjective[];
  modules: LearningModule[];
  references: Array<{ courseId: string; title: string; note: string }>;
};
export type LearningWorkspace = {
  canEdit?: boolean;
  courseId: string;
  revision: number;
  context: "personal" | "school" | "store";
  storeId: string | null;
  draft: LearningDraft;
  publishedVersion: string | null;
  updatedAt: string;
};
export type LearningJob = {
  id: string;
  courseId: string;
  stage: "outline" | "lessons" | "source";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  error: string | null;
  result: LearningDraft | null;
  baseRevision: number;
};
export type LearningReview = {
  id: string;
  reviewerId: string;
  reviewerName: string;
  revision: number;
  status: string;
  comments: string;
  independent: boolean;
};
export type LearningProfile = {
  goals: string;
  level: string;
  language: string;
  minutesPerDay: number;
};
export type LearningPublication = {
  id: string;
  courseId: string;
  version: number;
  title: string;
  summary: string;
  creator: string;
  kind: "course" | "path";
  priceUgx: number;
  visibility: string;
  labels: string[];
  objectives: LearningObjective[];
  modules: LearningModule[];
  references: LearningDraft["references"];
  cohorts?: Array<{
    id: string;
    name: string;
    startsAt: string;
    seatsLeft: number | null;
  }>;
  tutoringEnabled?: boolean;
  sharingEnabled?: boolean;
  hasAccess: boolean;
  owner: boolean;
};
export type LearningCreatorConfig = {
  enabled: boolean;
  ready: boolean;
  aiEnabled: boolean;
  tutoringEnabled: boolean;
  uploadsEnabled: boolean;
  publishingEnabled: boolean;
  sellingEnabled: boolean;
  maxUploadMb: number;
  maxModules: number;
  maxLessons: number;
  maxResources: number;
  reviewRequired: boolean;
};

export const emptyLearningDraft = (): LearningDraft => ({
  title: "",
  summary: "",
  kind: "course",
  language: "English",
  audience: "",
  goal: "",
  curriculum: "",
  sourceText: "",
  priceUgx: 0,
  visibility: "private",
  objectives: [],
  modules: [],
  references: [],
});

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
export function learningCreatorMethods(request: Request) {
  const root = "/v1/education/creator";
  const json = (body: unknown, method = "POST"): RequestInit => ({
    method,
    body: JSON.stringify(body),
  });
  return {
    learningCreatorConfig: () =>
      request<LearningCreatorConfig>(`${root}/config`),
    learningWorkspaces: () =>
      request<{ workspaces: LearningWorkspace[] }>(`${root}/courses`),
    learningProfile: () =>
      request<{ profile: LearningProfile }>(`${root}/profile`),
    saveLearningProfile: (profile: LearningProfile) =>
      request<{ ok: boolean }>(`${root}/profile`, json(profile, "PUT")),
    createLearningWorkspace: (input: {
      title: string;
      classId?: string;
      courseId?: string;
      storeId?: string;
      kind?: "course" | "path";
    }) =>
      request<{ workspace: LearningWorkspace }>(`${root}/courses`, json(input)),
    learningWorkspace: (id: string) =>
      request<{ workspace: LearningWorkspace; reviews: LearningReview[] }>(
        `${root}/courses/${encodeURIComponent(id)}`,
      ),
    saveLearningDraft: (id: string, revision: number, draft: LearningDraft) =>
      request<{ workspace: LearningWorkspace }>(
        `${root}/courses/${encodeURIComponent(id)}`,
        json({ revision, draft }, "PUT"),
      ),
    generateLearningContent: (
      id: string,
      revision: number,
      stage: "outline" | "lessons" | "source",
      requestId: string,
      resourceId?: string,
    ) =>
      request<{ job: LearningJob }>(
        `${root}/courses/${encodeURIComponent(id)}/jobs`,
        json({ revision, stage, requestId, resourceId }),
      ),
    learningJob: (id: string) =>
      request<{ job: LearningJob }>(`${root}/jobs/${encodeURIComponent(id)}`),
    cancelLearningJob: (id: string) =>
      request<{ ok: boolean }>(
        `${root}/jobs/${encodeURIComponent(id)}/cancel`,
        json({}),
      ),
    publishLearningCourse: (id: string, revision: number) =>
      request<{ publicationId: string }>(
        `${root}/courses/${encodeURIComponent(id)}/publish`,
        json({ revision }),
      ),
    studyLearningDraft: (id: string, revision: number) =>
      request<{ publicationId: string }>(
        `${root}/courses/${encodeURIComponent(id)}/study`,
        json({ revision }),
      ),
    inviteLearningReviewer: (id: string, reviewerId: string) =>
      request<{ ok: boolean }>(
        `${root}/courses/${encodeURIComponent(id)}/reviewers`,
        json({ reviewerId }),
      ),
    submitLearningReview: (
      id: string,
      revision: number,
      status: "approved" | "changes_requested",
      comments: string,
    ) =>
      request<{ ok: boolean }>(
        `${root}/courses/${encodeURIComponent(id)}/reviews`,
        json({ revision, status, comments }),
      ),
    learningReviewInbox: () =>
      request<{
        invitations: Array<{
          courseId: string;
          title: string;
          revision: number;
        }>;
      }>(`${root}/reviews`),
    learningPublication: (courseId: string) =>
      request<{ publication: LearningPublication }>(
        `${root}/publications/${encodeURIComponent(courseId)}`,
      ),
    publicLearningPublication: (courseId: string) =>
      request<{ publication: LearningPublication }>(
        `/v1/education/creator-public/${encodeURIComponent(courseId)}`,
      ),
    joinLearningPublication: (courseId: string, cohortId?: string) =>
      request<{ ok: boolean }>(
        `${root}/publications/${encodeURIComponent(courseId)}/join`,
        json({ cohortId }),
      ),
    learningCohorts: (courseId: string) =>
      request<{ cohorts: NonNullable<LearningPublication["cohorts"]> }>(
        `${root}/courses/${encodeURIComponent(courseId)}/cohorts`,
      ),
    createLearningInvite: (
      courseId: string,
      recipientId: string,
      cohortId?: string,
    ) =>
      request<{ token: string }>(
        `${root}/courses/${encodeURIComponent(courseId)}/invites`,
        json({ recipientId, cohortId }),
      ),
    acceptLearningInvite: (token: string) =>
      request<{ courseId: string }>(`${root}/invites/accept`, json({ token })),
    learningTutorHistory: (courseId: string) =>
      request<{ messages: Array<{ role: string; text: string }> }>(
        `${root}/publications/${encodeURIComponent(courseId)}/tutor`,
      ),
    learningTutor: (
      courseId: string,
      lessonId: string,
      text: string,
      requestId: string,
      cohortId?: string,
    ) =>
      request<{ text: string }>(
        `${root}/publications/${encodeURIComponent(courseId)}/tutor`,
        json({ lessonId, text, requestId }),
      ),
    answerLearningQuestion: (
      courseId: string,
      lessonId: string,
      questionId: string,
      answer: number,
    ) =>
      request<{ correct: boolean; explanation: string }>(
        `${root}/publications/${encodeURIComponent(courseId)}/answer`,
        json({ lessonId, questionId, answer }),
      ),
    completeLearningLesson: (courseId: string, lessonId: string) =>
      request<{ ok: boolean }>(
        `${root}/publications/${encodeURIComponent(courseId)}/complete`,
        json({ lessonId }),
      ),
    learningProgress: (courseId: string) =>
      request<{
        lessonIds: string[];
        evidence: Array<{
          objectiveId: string;
          correct: number;
          attempts: number;
        }>;
      }>(`${root}/publications/${encodeURIComponent(courseId)}/progress`),
    uploadLearningResource: (courseId: string, file: File) =>
      request<{ resource: LearningResource }>(
        `${root}/courses/${encodeURIComponent(courseId)}/resources`,
        {
          method: "POST",
          body: file,
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
            "X-Upload-Length": String(file.size),
          },
        },
      ),
    learningResourceUrl: (id: string) =>
      request<{ url: string }>(
        `${root}/resources/${encodeURIComponent(id)}/url`,
      ),
    learningCreatorPermissions: () =>
      request<{
        permissions: Array<{
          user_id: string;
          name: string;
          permission: string;
          school_id: string;
          active: number;
        }>;
      }>(`${root}/permissions`),
    setLearningCreatorPermission: (input: {
      userId: string;
      permission: string;
      schoolId: string;
      active: boolean;
      evidence: string;
    }) => request<{ ok: boolean }>(`${root}/permissions`, json(input)),
    sendLearningShare: (courseId: string, recipientId: string, note: string) =>
      request<{ ok: boolean }>(
        `${root}/publications/${encodeURIComponent(courseId)}/share`,
        json({ recipientId, note }),
      ),
    learningSharedInbox: () =>
      request<{
        messages: Array<{
          id: string;
          courseId: string;
          title: string;
          sender: string;
          note: string;
          createdAt: string;
        }>;
      }>(`${root}/shares`),
    buyLearningPublication: (
      courseId: string,
      publicationId: string,
      price: number,
      requestId: string,
      cohortId?: string,
    ) =>
      request<{ ok: boolean }>(
        `${root}/publications/${encodeURIComponent(courseId)}/buy`,
        json({ publicationId, price, requestId, cohortId }),
      ),
    learningEarnings: () =>
      request<{
        purchases: Array<{
          id: string;
          title: string;
          price_ugx: number;
          commission_ugx: number;
          status: string;
          environment: string;
        }>;
      }>(`${root}/earnings`),
    refundLearningPurchase: (purchaseId: string) =>
      request<{ ok: boolean }>(
        `${root}/purchases/${encodeURIComponent(purchaseId)}/refund`,
        json({}),
      ),
  };
}
