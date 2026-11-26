/**
 * Typed calls for the Peebee Work engine (`/v1/work`): used by the Peebee Work
 * provider app and, later, the customer app. Mirrors apps/api/src/work.
 */

export type WorkServiceType = "clean" | "fix" | "laundry";
export type WorkPricingMode = "fixed" | "quote";
export type WorkMatchingMode = "broadcast" | "customer_picks" | "admin_assigns";

export type WorkService = {
  id: string;
  type: WorkServiceType;
  category: string;
  name: string;
  description: string;
  pricingMode: WorkPricingMode;
  unitLabel: string;
  unitPriceUgx: number;
  calloutFeeUgx: number;
  minQuantity: number;
  maxQuantity: number;
};

export type WorkPublicSettings = {
  enabled: boolean;
  serviceTypes: WorkServiceType[];
  pricingModes: WorkPricingMode[];
  matchingModes: WorkMatchingMode[];
  defaultMatching: WorkMatchingMode;
  providerKinds?: string[];
  /** Photos, chat and live location for jobs; each is off until its migration is in and admin allows it. */
  photosEnabled?: boolean;
  maxPhotosPerJob?: number;
  maxPhotoKb?: number;
  chatEnabled?: boolean;
  trackingEnabled?: boolean;
  quoteValidHours: number;
  freeCancelMinutes: number;
  lateCancelFeePercent: number;
  autoConfirmHours: number;
  disputeWindowHours: number;
  minLeadMinutes: number;
  maxAdvanceDays: number;
  /** Quick scheduling choices; absent from an older API (the app then uses 60 and 180 minutes, and tomorrow at 09:00). */
  scheduleQuickMinutes?: number[];
  scheduleTomorrowEnabled?: boolean;
  scheduleTomorrowTime?: string;
};

export type WorkJobStatus =
  | "open" | "assigned" | "quoted" | "booked" | "in_progress" | "completed" | "settled" | "cancelled" | "expired" | "disputed" | "refunded";

export type WorkJobProvider = { id: string; kind: string; name: string; bio: string; rating: number | null; ratingCount: number; jobsCompleted: number };

export type WorkJob = {
  id: string;
  status: WorkJobStatus;
  /** Only present for a provider once the job is theirs. */
  customer: { name: string; phone: string | null } | null;
  service: { id: string; type: WorkServiceType; name: string };
  pricingMode: WorkPricingMode;
  matchingMode: WorkMatchingMode;
  quantity: number;
  details: string;
  address: string;
  area: string | null;
  lat: number | null;
  lng: number | null;
  scheduledFor: string | null;
  unitPriceUgx: number;
  calloutFeeUgx: number;
  priceUgx: number;
  heldUgx: number;
  commissionPercent: number;
  commissionUgx: number;
  expiresAt: string | null;
  quoteExpiresAt: string | null;
  confirmBy: string | null;
  provider: WorkJobProvider | null;
  workerName: string | null;
  rating: number | null;
  review: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  disputeReason: string | null;
  resolutionNote: string | null;
  createdAt: string;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  settledAt: string | null;
  /** How many times this job has gone back out to other providers. */
  rematchCount?: number;
  /** When the provider marked themselves as arrived at the address (only while the job is booked or in progress). */
  arrivedAt?: string | null;
  /** Where the provider is while the job is booked or in progress (customer and staff only). */
  providerLocation?: { lat: number; lng: number; updatedAt: string | null } | null;
  /** On the provider's open-jobs feed: their own offer, if any. */
  myOffer?: { price_ugx: number; eta_minutes: number | null; status: string } | null;
};

export type WorkNearby = {
  radiusKm: number;
  total: number;
  counts: Record<WorkServiceType, number>;
  pins: { type: WorkServiceType; lat: number; lng: number }[];
  degraded?: boolean;
};

export type WorkCustomerAction = "cancel" | "accept_quote" | "decline_quote" | "choose_provider" | "confirm" | "report_problem" | "rate";

export type WorkProviderProfile = {
  id: string;
  kind: "individual" | "company";
  displayName: string;
  companyName: string | null;
  phone: string | null;
  bio: string;
  status: "pending" | "approved" | "suspended" | "rejected";
  statusNote: string | null;
  online: boolean;
  role: "owner" | "staff";
  rating: number | null;
  ratingCount: number;
  jobsCompleted: number;
  services: { id: string; type: WorkServiceType; category: string; name: string }[];
};

export type WorkStaffMember = { user_id: string; role: "owner" | "staff"; status: "active" | "revoked"; name: string; phone: string | null };

export type WorkPhoto = { id: string; phase: "request" | "before" | "after"; uploaderKind: "customer" | "provider"; note: string | null; sizeBytes: number; createdAt: string };
export type WorkMessage = { id: string; from: "customer" | "provider"; senderName?: string; body: string; createdAt: string };

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export function workMethods(request: Request) {
  const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });
  return {
    // ---- Laundry Marketplace ----
    laundryCatalog() {
      return request<{
        items: Array<{
          id: string;
          name: string;
          category: string;
          maxCount: number;
          washUgx: number | null;
          dryCleanUgx: number | null;
          ironUgx: number | null;
          sortOrder: number;
          active: boolean;
        }>;
        packages: Array<{
          id: string;
          name: string;
          description: string;
          minLb: number | null;
          maxLb: number | null;
          priceUgx: number;
          maxCount: number;
          sortOrder: number;
          active: boolean;
        }>;
        settings: {
          pricing: Record<string, "fixed" | "estimate">;
          offer: { minPercent: number; maxPercent: number; stepUgx: number };
          tips: { freeEnabled: boolean; conditionalEnabled: boolean; maxUgx: number; stepUgx: number; ontimeHours: number };
          rides: { pickupPayer: string; deliveryPayer: string; splitCustomerPercent: number };
          overageUgxPerLb: number;
        };
      }>("/v1/work/laundry/catalog");
    },
    laundryQuote(input: {
      items?: Array<{ itemId: string; treatment: "wash" | "dry_clean" | "iron"; count: number }>;
      packages?: Array<{ packageId: string; count: number }>;
      offerUgx?: number;
      tip?: { kind: "none" | "free" | "conditional"; amountUgx: number };
    }) {
      return post<{
        currency: string;
        lines: Array<{ itemId: string; treatment: string; count: number; unitUgx: number; lineUgx: number; name?: string }>;
        packageLines: Array<{ packageId: string; name: string; count: number; unitUgx: number; lineUgx: number }>;
        catalogueUgx: number;
        pricingMode: "fixed" | "estimate";
        offerBand: { minUgx: number; averageUgx: number; maxUgx: number; stepUgx: number } | null;
        goodsUgx: number;
        tip: { kind: string; amountUgx: number };
        rides: { customerUgx: number; providerUgx: number; pickup: { customer: number; provider: number }; delivery: { customer: number; provider: number } };
        customerFeeUgx: number;
        customerTotalUgx: number;
      }>("/v1/work/laundry/quote", input);
    },
    laundryOrder(input: {
      items?: Array<{ itemId: string; treatment: "wash" | "dry_clean" | "iron"; count: number }>;
      packages?: Array<{ packageId: string; count: number }>;
      offerUgx?: number;
      tip?: { kind: "none" | "free" | "conditional"; amountUgx: number };
      address: string;
      area?: string;
      lat?: number;
      lng?: number;
      scheduledFor?: string;
      matchingMode?: WorkMatchingMode;
      idempotencyKey?: string;
      frequency?: "one_time" | "weekly" | "biweekly";
      detergent?: "standard" | "fragrance_free";
      contactless?: boolean;
      notes?: string;
      expectedTotalUgx?: number;
    }) {
      return post<{ job: WorkJob; actions: WorkCustomerAction[]; repeated?: boolean; totalUgx: number }>("/v1/work/laundry/orders", input);
    },
    // ---- Customer ----
    workCatalog(type?: WorkServiceType) {
      return request<{ services: WorkService[]; settings: WorkPublicSettings }>(`/v1/work/catalog${type ? `?type=${type}` : ""}`);
    },
    /** Nearby providers by trade for the Hive map. Pins are coarse and jittered; no ids or exact positions. */
    workNearby(lat: number, lng: number) {
      return request<WorkNearby>(`/v1/work/nearby?lat=${lat}&lng=${lng}`);
    },
    workBook(input: {
      serviceId: string;
      quantity?: number;
      details?: string;
      address: string;
      area?: string;
      lat?: number;
      lng?: number;
      scheduledFor?: string;
      matchingMode?: WorkMatchingMode;
      idempotencyKey?: string;
    }) {
      return post<{ job: WorkJob; actions: WorkCustomerAction[]; repeated?: boolean }>("/v1/work/jobs", input);
    },
    workMyJobs() {
      return request<{ jobs: (WorkJob & { actions: WorkCustomerAction[] })[] }>("/v1/work/jobs");
    },
    workJob(id: string) {
      return request<{ job: WorkJob; actions: WorkCustomerAction[]; offers: { id: string; priceUgx: number; etaMinutes: number | null; message: string; provider: WorkJobProvider }[]; timeline: { action: string; actor_kind: string; created_at: string }[] }>(`/v1/work/jobs/${encodeURIComponent(id)}`);
    },
    workSelectOffer(jobId: string, offerId: string) {
      return post<{ job: WorkJob }>(`/v1/work/jobs/${encodeURIComponent(jobId)}/offers/${encodeURIComponent(offerId)}/select`);
    },
    workAcceptQuote(jobId: string) {
      return post<{ job: WorkJob }>(`/v1/work/jobs/${encodeURIComponent(jobId)}/quote/accept`);
    },
    workDeclineQuote(jobId: string) {
      return post<{ ok: true }>(`/v1/work/jobs/${encodeURIComponent(jobId)}/quote/decline`);
    },
    workCancel(jobId: string, reason?: string) {
      return post<{ ok: true }>(`/v1/work/jobs/${encodeURIComponent(jobId)}/cancel`, { reason });
    },
    workConfirm(jobId: string) {
      return post<{ ok: true }>(`/v1/work/jobs/${encodeURIComponent(jobId)}/confirm`);
    },
    workReportProblem(jobId: string, reason: string) {
      return post<{ ok: true }>(`/v1/work/jobs/${encodeURIComponent(jobId)}/dispute`, { reason });
    },
    workRate(jobId: string, rating: number, review?: string) {
      return post<{ ok: true }>(`/v1/work/jobs/${encodeURIComponent(jobId)}/rate`, { rating, review });
    },

    workJobPhotos(jobId: string) {
      return request<{ photos: WorkPhoto[] }>(`/v1/work/jobs/${encodeURIComponent(jobId)}/photos`);
    },
    workUploadJobPhoto(jobId: string, file: Blob, note?: string) {
      const form = new FormData();
      form.append("file", file, "photo.jpg");
      if (note) form.append("note", note);
      return request<{ photo: WorkPhoto }>(`/v1/work/jobs/${encodeURIComponent(jobId)}/photos`, { method: "POST", body: form });
    },
    workJobMessages(jobId: string, after?: string) {
      return request<{ messages: WorkMessage[] }>(`/v1/work/jobs/${encodeURIComponent(jobId)}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`);
    },
    workSendJobMessage(jobId: string, body: string) {
      return post<{ message: WorkMessage }>(`/v1/work/jobs/${encodeURIComponent(jobId)}/messages`, { body });
    },

    // ---- Laundry Admin ----
    workAdminLaundrySettings() {
      return request<{
        settings: {
          pricing: Record<string, "fixed" | "estimate">;
          offerMinPercent: number;
          offerMaxPercent: number;
          offerStepUgx: number;
          ridePayerPickup: "customer" | "provider" | "split";
          ridePayerDelivery: "customer" | "provider" | "split";
          rideSplitCustomerPercent: number;
          rideFeeUgx: number;
          overageUgxPerLb: number;
          tipFreeEnabled: boolean;
          tipConditionalEnabled: boolean;
          tipMaxUgx: number;
          tipOntimeHours: number;
          commissionTiming: "on_payout" | "at_checkout";
          cancelCommission: "refund" | "keep";
          providerCommissionPercent: number;
          customerFeeEnabled: boolean;
          customerFeeType: "flat" | "percent";
          customerFeeValue: number;
          customerFeeMaxSharePercent: number;
        };
      }>("/v1/work/admin/laundry/settings");
    },
    workAdminUpdateLaundrySettings(input: Record<string, any>) {
      return request<{ settings: any }>("/v1/work/admin/laundry/settings", {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    workAdminLaundryItems() {
      return request<{
        items: Array<{
          id: string;
          name: string;
          category: string;
          washUgx: number | null;
          dryCleanUgx: number | null;
          ironUgx: number | null;
          maxCount: number;
          sortOrder: number;
          active: boolean;
        }>;
        packages: Array<{
          id: string;
          name: string;
          description: string;
          minLb: number | null;
          maxLb: number | null;
          priceUgx: number;
          maxCount: number;
          sortOrder: number;
          active: boolean;
        }>;
      }>("/v1/work/admin/laundry/items");
    },
    workAdminUpdateLaundryItem(id: string, input: Record<string, any>) {
      return request<{ ok: true }>(`/v1/work/admin/laundry/items/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    workAdminCreateLaundryItem(input: Record<string, any>) {
      return request<{ id: string }>("/v1/work/admin/laundry/items", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    workAdminUpdateLaundryPackage(id: string, input: Record<string, any>) {
      return request<{ ok: true }>(`/v1/work/admin/laundry/packages/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    // ---- Provider ----
    workProviderRegister(input: { kind: "individual" | "company"; displayName: string; companyName?: string; phone?: string; bio?: string; serviceIds: string[] }) {
      return post<{ provider: WorkProviderProfile }>("/v1/work/provider/register", input);
    },
    workProviderMe() {
      return request<{ provider: WorkProviderProfile; canWork: boolean }>("/v1/work/provider/me");
    },
    workProviderUpdate(input: { displayName?: string; companyName?: string; phone?: string; bio?: string; serviceIds?: string[]; online?: boolean; lat?: number; lng?: number }) {
      return request<{ provider: WorkProviderProfile }>("/v1/work/provider/me", { method: "PUT", body: JSON.stringify(input) });
    },
    workStaff() {
      return request<{ staff: WorkStaffMember[] }>("/v1/work/provider/staff");
    },
    workAddStaff(identifier: string) {
      return post<{ ok: true; staff: { userId: string; name: string } }>("/v1/work/provider/staff", { identifier });
    },
    workRemoveStaff(userId: string) {
      return request<{ ok: true }>(`/v1/work/provider/staff/${encodeURIComponent(userId)}`, { method: "DELETE" });
    },
    workOpenJobs() {
      return request<{ jobs: WorkJob[] }>("/v1/work/provider/jobs/open");
    },
    workProviderJob(jobId: string) {
      return request<{ job: WorkJob; role: "owner" | "staff" }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}`);
    },
    workProviderJobs(status?: string) {
      return request<{ jobs: WorkJob[] }>(`/v1/work/provider/jobs${status ? `?status=${encodeURIComponent(status)}` : ""}`);
    },
    workAcceptJob(jobId: string) {
      return post<{ job: WorkJob }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/accept`);
    },
    workOfferOnJob(jobId: string, input: { priceUgx?: number; etaMinutes?: number; message?: string }) {
      return post<{ ok: true; priceUgx: number }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/offer`, input);
    },
    workWithdrawOffer(jobId: string) {
      return request<{ ok: true }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/offer`, { method: "DELETE" });
    },
    workQuote(jobId: string, priceUgx: number) {
      return post<{ job: WorkJob }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/quote`, { priceUgx });
    },
    workAssignWorker(jobId: string, workerId: string) {
      return post<{ job: WorkJob }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/assign-worker`, { workerId });
    },
    /** Accepted only when the provider\'s latest location is at the job address; the API explains if not. */
    workArrived(jobId: string) {
      return post<{ ok: true; repeated?: boolean }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/arrived`);
    },
    workStartJob(jobId: string) {
      return post<{ job: WorkJob }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/start`);
    },
    workCompleteJob(jobId: string, note?: string) {
      return post<{ job: WorkJob }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/complete`, { note });
    },
    workProviderCancel(jobId: string, reason?: string) {
      return post<{ ok: true; rematched?: boolean }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/cancel`, { reason });
    },
    workProviderJobPhotos(jobId: string) {
      return request<{ photos: WorkPhoto[] }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/photos`);
    },
    workProviderUploadPhoto(jobId: string, file: Blob, phase: "before" | "after", note?: string) {
      const form = new FormData();
      form.append("file", file, "photo.jpg");
      form.append("phase", phase);
      if (note) form.append("note", note);
      return request<{ photo: WorkPhoto }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/photos`, { method: "POST", body: form });
    },
    workProviderMessages(jobId: string, after?: string) {
      return request<{ messages: WorkMessage[] }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`);
    },
    workProviderSendMessage(jobId: string, body: string) {
      return post<{ message: WorkMessage }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/messages`, { body });
    },
    /** `accuracy` is the device's own estimate of its error in metres; low-quality fixes are ignored by the on-site checks. */
    workShareLocation(jobId: string, lat: number, lng: number, accuracy?: number) {
      return post<{ ok: true; stored: boolean }>(`/v1/work/provider/jobs/${encodeURIComponent(jobId)}/location`, { lat, lng, ...(accuracy != null && Number.isFinite(accuracy) ? { accuracy } : {}) });
    },
    workEarnings() {
      return request<{ providerId: string; paidUgx: number; paidJobs: number; upcomingUgx: number; upcomingJobs: number; jobsCompleted: number; workWalletReady: boolean; workWalletBalance: number; personalWalletActive: boolean; personalWalletActivationAvailable: boolean; providerWalletTransfersEnabled: boolean }>("/v1/work/provider/earnings");
    },
  };
}
