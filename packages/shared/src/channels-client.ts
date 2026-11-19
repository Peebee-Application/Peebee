/**
 * Typed calls for Channels: channels, posts, the shared Spotlight feed, memberships, tips, creator
 * money and verification, causes, rewards, and the Admin queues. Mirrors apps/api/src/channels.
 */
import type { ChannelsConfig } from "./channels-config.js";

export type PublisherType = "channel" | "personal" | "store" | "restaurant" | "learn" | "driver";
export type PostType = "video" | "image" | "carousel" | "text" | "audio" | "live";
export type PostAccess = "free" | "members" | "pay_per_view";
export type PostStatus = "draft" | "scheduled" | "review" | "published" | "removed";

export type PublisherView = { type: PublisherType; id: string; name: string; handle: string | null; avatarUrl: string | null; verified: boolean; href: string | null };

/** What the app needs to know about the current rules. A trimmed copy of the Admin settings. */
export type ChannelsPublicConfig = {
  enabled: boolean;
  channelsOpen?: boolean;
  ageDeclarationRequired?: boolean;
  minAge?: number;
  handle?: { min: number; max: number };
  maxBioChars?: number;
  maxLinks?: number;
  publishing?: {
    personalPosting: boolean; publishers: string[]; postTypes: string[]; maxCaptionChars: number; maxCarouselImages: number; maxPollOptions: number; maxTags: number;
    maxImageMb: number; maxAudioMb: number; schedulingEnabled: boolean; commentsEnabled: boolean; reactionsEnabled: boolean; maxCommentChars: number;
  };
  moderationMode?: "after" | "before";
  live?: {
    enabled: boolean; commentsEnabled: boolean; helperEnabled: boolean; maxMinutes: number;
    broadcastsEnabled?: boolean; premieresEnabled?: boolean; minLeadMinutes?: number; maxLeadDays?: number; maxProgramItems?: number; maxLoops?: number; remindersEnabled?: boolean;
  };
  monetization?: {
    enabled: boolean; memberships: boolean; payPerView: boolean; tips: boolean; gifts: boolean; giftOptions: string; maxTiers: number; minTierPriceUgx: number; maxTierPriceUgx: number;
    minPayPerViewUgx: number; maxPayPerViewUgx: number; minTipUgx: number; maxTipUgx: number; maxPreviewSeconds: number; earningsToWalletEnabled: boolean;
  };
  kyc?: { required: boolean; withdrawalsEnabled: boolean; minWithdrawUgx: number; idTypes: string[]; requireSelfie: boolean; requireIdBack: boolean; minAge: number };
  causes?: {
    enabled: boolean; requireApproval: boolean; minGoalUgx: number; maxGoalUgx: number; minDays: number; maxDays: number; allowAllOrNothing: boolean; defaultFundingMode: "keep" | "all_or_nothing";
    guestDonations: boolean; donorTipEnabled: boolean; minDonationUgx: number; maxDonationUgx: number; allowAnonymous: boolean; allowWalletPayment: boolean; allowMobileMoney: boolean;
  };
  rewards?: { enabled: boolean; minCashoutPoints: number };
};

export type ChannelView = {
  id: string; handle: string; displayName: string; bio: string; avatarUrl: string | null; bannerUrl: string | null; category: string | null;
  links: Array<{ label: string; url: string }>; verified: boolean; status: string; followerCount: number; postCount: number; createdAt: string; isOwner: boolean; isFollowing: boolean;
};

export type TierView = { id: string; name: string; description: string | null; priceUgx: number; periodDays: number; perks: string[]; members: number; active?: boolean };

export type PostLock = { reason: string; access: PostAccess; priceUgx: number; previewSeconds: number; minTierId: string | null };

export type PostView = {
  id: string; publisher: PublisherView | null; type: PostType; caption: string; tags: string[]; language: string | null;
  media: { images: Array<string | null>; audioUrl: string | null; liveUrl: string | null; videoAssetId: string | null; coverUrl: string | null; durationSeconds: number | null };
  poll: { question: string; options: Array<{ text: string; votes: number }>; total: number; myVote: number | null } | null;
  productRef: { type: string; id: string } | null;
  access: PostAccess; priceUgx: number; previewSeconds: number; locked: PostLock | null;
  status: PostStatus; publishedAt: string | null; scheduledAt: string | null; liveStatus: string | null; event?: AiringView | null;
  counts: { views: number; likes: number; comments: number }; liked: boolean; toChannel: boolean; toSpotlight: boolean; isMine: boolean; removedReason: string | null; createdAt: string;
};

export type PostInput = {
  publisherType: PublisherType; publisherId: string; type: PostType; caption?: string; tags?: string[]; language?: string; images?: string[]; audioPath?: string | null;
  liveUrl?: string | null; videoAssetId?: string | null; coverPath?: string | null; poll?: { question?: string; options: string[] } | null; productRef?: { type: string; id: string } | null;
  access?: PostAccess; priceUgx?: number; previewSeconds?: number; minTierId?: string | null; toChannel?: boolean; toSpotlight?: boolean; publish?: boolean; scheduledAt?: string | null;
};

export type PostPlayback = {
  playback: { hlsUrl?: string; mp4Url?: string; posterUrl?: string; expiresAt?: string };
  preview: boolean; previewSeconds?: number; adFreeForMembers?: boolean; access: string;
};

export type CommentView = { id: string; body: string; author: string; createdAt: string; mine: boolean; canDelete: boolean };

export type CauseView = {
  id: string; slug: string; title: string; story: string; coverUrl: string | null; beneficiary: string | null; goalUgx: number; raisedUgx: number; percent: number; donorCount: number;
  endsAt: string; daysLeft: number; status: string; fundingMode: string; publishedAt: string | null;
  channel: { handle: string; displayName: string; avatarUrl: string | null; verified: boolean } | null;
  updates: Array<{ id: string; body: string; createdAt: string }>;
  donors: Array<{ name: string; amountUgx: number; message: string | null; createdAt: string }>;
  rejectionReason?: string | null; releasedUgx?: number; refundedUgx?: number; releasableUgx?: number;
};

export type CauseInput = { title: string; story: string; coverPath?: string | null; beneficiary?: string; goalUgx: number; days: number; fundingMode?: string };

export type DonateInput = { amountUgx: number; tipUgx?: number; name?: string; anonymous?: boolean; message?: string; method: "wallet" | "momo"; msisdn?: string };

export type KycState = {
  status: "none" | "pending" | "approved" | "rejected" | "expired"; required: boolean; fullName: string | null; idType: string | null; idNumberMasked: string | null; reviewNotes: string | null;
  submittedAt: string | null; reviewedAt: string | null; rules: { idTypes: string[]; requireSelfie: boolean; requireIdBack: boolean; minAge: number; maxDocumentMb: number };
};

export type PayoutAccountView = { id: string; type: string; network: string | null; accountMasked: string; accountName: string; createdAt: string };

export type WithdrawalOverview = {
  enabled: boolean; availableUgx: number; lifetimeUgx: number; kyc: KycState; accounts: PayoutAccountView[];
  limits: { minUgx: number; maxUgx: number; dailyCapUgx: number; monthlyCapUgx: number; withdrawnTodayUgx: number; withdrawnThisMonthUgx: number; accountCooldownDays: number };
  canMoveToWallet: boolean; recent: Array<{ id: string; amountUgx: number; status: string; network: string | null; createdAt: string }>;
};

export type EarningsSummary = {
  availableUgx: number; lifetimeUgx: number; members: number; last30Days: Array<{ kind: string; netUgx: number; count: number }>;
  recent: Array<{ id: string; kind: string; grossUgx: number; feeUgx: number; netUgx: number; note: string | null; createdAt: string }>;
};

export type RewardsSummary = {
  enabled: boolean; points: number; lifetimePoints: number; estimatedValueUgx: number; currentRateUgxPer1000: number; rateBasis: string; minCashoutPoints: number; nextCashoutAt: string | null;
  history: Array<{ id: string; points: number; requestedUgx: number; paidUgx: number; scalePercent: number; createdAt: string }>;
};

export type MyChannelResponse = { config: ChannelsPublicConfig; channel: ChannelView | null; identities: PublisherView[] };

export type ChannelsAdminOverview = {
  migrationApplied: boolean; tables: { money: boolean; causes: boolean; rewards: boolean }; currentRateUgxPer1000: number;
  stats: null | {
    channels: number; suspendedChannels: number; postsPublished: number; postsInReview: number; openReports: number; kycPending: number; causesWaiting: number; liveCauses: number;
    withdrawalsPending: number; creatorBalancesUgx: number; rewardPointsOutstanding: number;
  };
};

/** The host's view of their own stream. `publishUrl` is private to the host. */
export type LiveHostView = { id: string; postId: string; status: "ready" | "live" | "ended"; title: string | null; provider: string; publishUrl: string | null; mock: boolean; startedAt: string | null; endsAt: string | null };
/** A broadcast (videos aired back to back) or a premiere (a video's first showing). */
export type AiringView = {
  id: string; kind: "broadcast" | "premiere"; status: "scheduled" | "on_air" | "ended"; title: string | null; startsAt: string; endsAt: string;
  durationSeconds: number; items: number; loops: number; reminders: number; remindMe: boolean;
};
export type AiringPlay = {
  kind: "broadcast" | "premiere"; status: "on_air"; serverNow: string; startsAt: string; endsAt: string;
  item: { index: number; count: number; title: string; durationSeconds: number; offsetSeconds: number; endsInSeconds: number; loop: number; loops: number };
  upNext: string | null;
  playback: { hlsUrl?: string; mp4Url?: string; posterUrl?: string; expiresAt?: string };
};
export type MyAiring = AiringView & { postId: string; peakViewers: number };

/** What a store sells on its live stream, for the Spotlight's Buy strip. */
export type LiveStoreItems = {
  status: "live" | "ended";
  store: { id: string; name: string; slug: string; logo_url: string; category: string } | null;
  items: Array<{ id: string; title: string; price: number; compare_at_price: number | null; image_url: string; in_stock: boolean; has_variants: boolean }>;
};
export type LiveComment = { id: number; author: string; body: string; byHost: boolean; pinned: boolean; hidden?: boolean; at: string };
export type LiveState = {
  id: string; status: "scheduled" | "live" | "ended"; title: string | null; role: "host" | "helper" | "viewer"; viewers: number | null; peakViewers: number | null;
  startedAt: string | null; endsAt: string | null; commentsEnabled: boolean; maxCommentChars: number; comments: LiveComment[]; cursor: number; hiddenIds: number[]; pinned: LiveComment | null; canModerate: boolean;
};

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export function channelsMethods(request: Request) {
  const send = <T>(method: string, path: string, body?: unknown) => request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const enc = encodeURIComponent;
  const q = (p: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
    return s ? `?${s}` : "";
  };
  return {
    // --- broadcasts and premieres
    createBroadcast(input: { publisherType: string; publisherId: string; title: string; assetIds: string[]; startsAt?: string | null; loops?: number }) { return send<{ airing: AiringView }>("POST", "/v1/airings/broadcast", input); },
    createPremiere(input: { postId: string; startsAt?: string | null }) { return send<{ airing: AiringView }>("POST", "/v1/airings/premiere", input); },
    myAirings() { return request<{ airings: MyAiring[] }>("/v1/airings/mine"); },
    airingPlay(ref: string) { return request<AiringPlay>(`/v1/airings/${enc(ref)}/play`); },
    airingRemind(ref: string, on: boolean) { return send<{ remindMe: boolean; reminders: number }>("POST", `/v1/airings/${enc(ref)}/remind`, { on }); },
    cancelAiring(ref: string) { return send<{ ok: true }>("POST", `/v1/airings/${enc(ref)}/cancel`); },
    rescheduleAiring(ref: string, startsAt: string) { return send<{ airing: AiringView }>("POST", `/v1/airings/${enc(ref)}/reschedule`, { startsAt }); },
    myReadyVideos() { return request<{ assets: Array<{ id: string; title: string | null; durationSeconds: number | null; posterUrl: string | null; createdAt: string }> }>("/v1/video/mine"); },

    // --- going live from a phone
    liveStart(input: { publisherType: string; publisherId: string; title?: string }) { return send<{ live: LiveHostView }>("POST", "/v1/live/start", input); },
    liveGo(id: string) { return send<{ live: LiveHostView }>("POST", `/v1/live/${enc(id)}/go`); },
    liveEnd(id: string) { return send<{ status: "ended"; seconds: number; peakViewers: number; comments: number }>("POST", `/v1/live/${enc(id)}/end`); },
    liveMine() { return request<{ live: LiveHostView | null; streams: Array<{ id: string; title: string | null; mine: boolean }> }>("/v1/live/mine"); },
    liveState(id: string, after = 0, beat = false) { return request<LiveState>(`/v1/live/${enc(id)}/state${q({ after: after || undefined, beat: beat ? 1 : undefined })}`); },
    liveComment(id: string, body: string) { return send<{ id: number }>("POST", `/v1/live/${enc(id)}/comments`, { body }); },
    liveModerate(id: string, commentId: number, action: "hide" | "pin" | "unpin") { return send<{ ok: true }>("POST", `/v1/live/${enc(id)}/comments/${commentId}/${action}`); },
    liveHelperCode(id: string) { return send<{ code: string; expiresAt: string }>("POST", `/v1/live/${enc(id)}/helper-code`); },
    liveJoinHelper(code: string) { return send<{ id: string; title: string | null }>("POST", "/v1/live/helper/join", { code }); },

    // --- public config, my channel
    channelsConfig() { return request<ChannelsPublicConfig>("/v1/channels/config"); },
    myChannel() { return request<MyChannelResponse>("/v1/channels/me"); },
    channelHandleAvailable(handle: string) { return request<{ available: boolean; reason: string | null }>(`/v1/channels/handle-available${q({ handle })}`); },
    openChannel(input: { handle: string; displayName: string; bio?: string; category?: string; avatarPath?: string | null; bannerPath?: string | null; links?: Array<{ label?: string; url: string }>; ageConfirmed?: boolean }) {
      return send<{ channel: ChannelView }>("POST", "/v1/channels", input);
    },
    updateMyChannel(input: Partial<{ handle: string; displayName: string; bio: string; category: string; avatarPath: string | null; bannerPath: string | null; links: Array<{ label?: string; url: string }> }>) {
      return send<{ channel: ChannelView }>("PATCH", "/v1/channels/me", input);
    },
    followingChannels() { return request<{ channels: ChannelView[] }>("/v1/channels/following"); },
    followChannel(id: string) { return send<{ following: true }>("POST", `/v1/channels/${enc(id)}/follow`); },
    unfollowChannel(id: string) { return send<{ following: false }>("DELETE", `/v1/channels/${enc(id)}/follow`); },
    publicChannel(handle: string) {
      return request<{ channel: ChannelView; tiers: TierView[]; causes: CauseView[]; membership: { id: string; tierId: string; status: string; currentPeriodEnd: string; autoRenew: boolean } | null }>(`/v1/public/channels/${enc(handle)}`);
    },
    publicChannelPosts(handle: string, cursor = 0) { return request<{ posts: PostView[]; nextCursor: number | null }>(`/v1/public/channels/${enc(handle)}/posts${q({ cursor })}`); },

    // --- posts and the Spotlight
    spotlightFeed(filter: "all" | "following" | "video" | "image" = "all", cursor = 0) { return request<{ posts: PostView[]; nextCursor: number | null; unavailable?: boolean }>(`/v1/spotlight/feed${q({ filter, cursor })}`); },
    createPost(input: PostInput) { return send<{ post: PostView }>("POST", "/v1/posts", input); },
    updatePost(id: string, input: Partial<PostInput>) { return send<{ post: PostView }>("PATCH", `/v1/posts/${enc(id)}`, input); },
    publishPost(id: string, scheduledAt?: string | null) { return send<{ post: PostView }>("POST", `/v1/posts/${enc(id)}/publish`, { scheduledAt }); },
    deletePost(id: string) { return send<{ ok: true }>("DELETE", `/v1/posts/${enc(id)}`); },
    myPosts(status?: PostStatus) { return request<{ posts: PostView[] }>(`/v1/posts/mine${q({ status })}`); },
    getPost(id: string) { return request<{ post: PostView }>(`/v1/posts/${enc(id)}`); },
    postPlayback(id: string) { return request<PostPlayback>(`/v1/posts/${enc(id)}/playback`); },
    likePost(id: string) { return send<{ liked: boolean; likeCount: number }>("POST", `/v1/posts/${enc(id)}/like`); },
    postComments(id: string, cursor = 0) { return request<{ comments: CommentView[]; nextCursor: number | null }>(`/v1/posts/${enc(id)}/comments${q({ cursor })}`); },
    commentOnPost(id: string, body: string) { return send<{ id: string; held: boolean }>("POST", `/v1/posts/${enc(id)}/comments`, { body }); },
    deleteComment(id: string) { return send<{ ok: true }>("DELETE", `/v1/comments/${enc(id)}`); },
    reportPost(id: string, reason: string, details?: string) { return send<{ ok: true }>("POST", `/v1/posts/${enc(id)}/report`, { reason, details }); },
    votePoll(id: string, option: number) { return send<{ ok: true }>("POST", `/v1/posts/${enc(id)}/vote`, { option }); },
    reportPostView(id: string, seconds: number) { return send<{ counted?: boolean; qualified?: boolean }>("POST", `/v1/posts/${enc(id)}/view`, { seconds }); },

    // --- memberships, unlocks, tips
    myTiers() { return request<{ tiers: TierView[] }>("/v1/creator/tiers"); },
    createTier(input: { name: string; description?: string; priceUgx: number; periodDays?: number; perks?: string[] }) { return send<{ id: string }>("POST", "/v1/creator/tiers", input); },
    updateTier(id: string, input: Partial<{ name: string; description: string; priceUgx: number; perks: string[]; active: boolean }>) { return send<{ ok: true }>("PATCH", `/v1/creator/tiers/${enc(id)}`, input); },
    subscribeToTier(id: string) { return send<{ subscription: { id: string; currentPeriodEnd: string } }>("POST", `/v1/tiers/${enc(id)}/subscribe`); },
    mySubscriptions() {
      return request<{ subscriptions: Array<{ id: string; status: string; priceUgx: number; currentPeriodEnd: string; autoRenew: boolean; tierName: string; channel: { id: string; handle: string; displayName: string } }> }>("/v1/subscriptions/mine");
    },
    cancelSubscription(id: string) { return send<{ ok: true }>("DELETE", `/v1/subscriptions/${enc(id)}`); },
    unlockPost(id: string) { return send<{ ok: true }>("POST", `/v1/posts/${enc(id)}/unlock`); },
    tipChannel(id: string, input: { amountUgx?: number; postId?: string | null; gift?: string | null }) { return send<{ kind: string }>("POST", `/v1/channels/${enc(id)}/tip`, input); },

    // --- creator money, rewards, verification
    creatorEarnings() { return request<EarningsSummary>("/v1/creator/earnings"); },
    creatorRewards() { return request<RewardsSummary>("/v1/creator/rewards"); },
    cashOutRewards(points?: number) { return send<{ points: number; paidUgx: number; scalePercent: number }>("POST", "/v1/creator/rewards/cashout", { points }); },
    kycState() { return request<KycState>("/v1/creator/kyc"); },
    submitKyc(input: { fullName: string; idType: string; idNumber: string; dateOfBirth: string; idFrontKey: string; idBackKey?: string | null; selfieKey?: string | null }) { return send<KycState>("POST", "/v1/creator/kyc", input); },
    payoutAccounts() { return request<{ accounts: PayoutAccountView[] }>("/v1/creator/payout-accounts"); },
    addPayoutAccount(input: { msisdn: string; accountName: string }) { return send<{ account: PayoutAccountView }>("POST", "/v1/creator/payout-accounts", input); },
    removePayoutAccount(id: string) { return send<{ ok: true }>("DELETE", `/v1/creator/payout-accounts/${enc(id)}`); },
    withdrawalOverview() { return request<WithdrawalOverview>("/v1/creator/withdrawals"); },
    withdraw(input: { amountUgx: number; payoutAccountId: string }) { return send<{ withdrawalId: string; amountUgx: number; status: string }>("POST", "/v1/creator/withdrawals", input); },
    refreshCreatorWithdrawal(id: string) { return send<{ id: string; status: string }>("POST", `/v1/creator/withdrawals/${enc(id)}/refresh`); },
    moveEarningsToWallet(amountUgx: number) { return send<{ walletBalanceUgx: number; movedUgx: number }>("POST", "/v1/creator/move-to-wallet", { amountUgx }); },

    // --- causes
    myCauses() { return request<{ causes: CauseView[] }>("/v1/creator/causes"); },
    createCause(input: CauseInput) { return send<{ cause: CauseView }>("POST", "/v1/creator/causes", input); },
    updateCause(id: string, input: Partial<CauseInput>) { return send<{ cause: CauseView }>("PATCH", `/v1/creator/causes/${enc(id)}`, input); },
    submitCause(id: string) { return send<{ cause: CauseView }>("POST", `/v1/creator/causes/${enc(id)}/submit`); },
    closeCause(id: string) { return send<{ ok: true }>("POST", `/v1/creator/causes/${enc(id)}/close`); },
    postCauseUpdate(id: string, body: string) { return send<{ ok: true }>("POST", `/v1/creator/causes/${enc(id)}/updates`, { body }); },
    releaseCause(id: string, amountUgx?: number) { return send<{ releasedUgx: number }>("POST", `/v1/creator/causes/${enc(id)}/release`, { amountUgx }); },
    publicCauses() { return request<{ causes: CauseView[] }>("/v1/public/causes"); },
    publicCause(slug: string) { return request<{ cause: CauseView }>(`/v1/public/causes/${enc(slug)}`); },
    donateToCause(slug: string, input: DonateInput) { return send<{ code: string; status: "pending" | "successful"; redirectUrl: string | null }>("POST", `/v1/public/causes/${enc(slug)}/donate`, input); },
    donationStatus(code: string) { return request<{ code: string; status: string; amountUgx: number; tipUgx: number; causeTitle: string; causeSlug: string; createdAt: string }>(`/v1/public/donations/${enc(code)}`); },

    // --- Admin
    adminChannelsOverview() { return request<ChannelsAdminOverview>("/v1/admin/channels"); },
    adminChannelsConfig() { return request<{ config: ChannelsConfig; fields: unknown[]; sections: unknown[] }>("/v1/admin/channels/config"); },
    adminSaveChannelsConfig(patch: unknown) { return send<{ config: ChannelsConfig }>("PUT", "/v1/admin/channels/config", patch); },
    adminRewardRates() { return request<{ rates: Array<{ id: string; effectiveFrom: string; ugxPer1000Points: number; note: string | null }>; currentUgxPer1000: number }>("/v1/admin/channels/rates"); },
    adminAddRewardRate(input: { effectiveFrom: string; ugxPer1000Points: number; note?: string }) { return send<{ id: string }>("POST", "/v1/admin/channels/rates", input); },
    adminChannelPosts(status: string) {
      return request<{ posts: Array<{ id: string; type: string; caption: string; status: string; access: string; reportCount: number; publisher: string; publisherType: string; removedReason: string | null; createdAt: string }> }>(`/v1/admin/channels/posts${q({ status })}`);
    },
    adminModeratePost(id: string, action: "approve" | "remove", reason?: string) { return send<{ ok: true }>("POST", `/v1/admin/channels/posts/${enc(id)}/moderate`, { action, reason }); },
    adminReports() {
      return request<{ reports: Array<{ id: string; reason: string; details: string | null; status: string; createdAt: string; post: { id: string; caption: string; type: string; status: string; reportCount: number; publisherType: string; publisherId: string } }> }>("/v1/admin/channels/reports");
    },
    adminResolveReport(id: string, action: "dismiss" | "remove_post" | "suspend_channel", reason?: string) { return send<{ ok: true }>("POST", `/v1/admin/channels/reports/${enc(id)}/resolve`, { action, reason }); },
    adminChannelList(query = "") {
      return request<{ channels: Array<{ id: string; handle: string; displayName: string; ownerName: string; ownerPhone: string; status: string; suspendedReason: string | null; verified: boolean; followers: number; createdAt: string }> }>(`/v1/admin/channels/list${q({ q: query })}`);
    },
    adminSetChannelStatus(id: string, status: "active" | "suspended", reason?: string) { return send<{ ok: true }>("POST", `/v1/admin/channels/${enc(id)}/status`, { status, reason }); },
    adminSetChannelBadge(id: string, verified: boolean) { return send<{ ok: true }>("POST", `/v1/admin/channels/${enc(id)}/badge`, { verified }); },
    adminKycQueue(status = "pending") {
      return request<{ checks: Array<{ userId: string; fullName: string; idType: string; status: string; submittedAt: string; age: number | null; accountName: string; phone: string }> }>(`/v1/admin/channels/kyc${q({ status })}`);
    },
    adminKycDetail(userId: string) {
      return request<{ userId: string; fullName: string; idType: string; idNumber: string; dateOfBirth: string; age: number | null; status: string; reviewNotes: string | null; submittedAt: string; accountName: string; phone: string; hasBack: boolean; hasSelfie: boolean; payoutAccounts: Array<{ name: string; network: string | null; number: string }> }>(`/v1/admin/channels/kyc/${enc(userId)}`);
    },
    adminReviewKyc(userId: string, decision: "approve" | "reject", notes?: string) { return send<{ ok: true }>("POST", `/v1/admin/channels/kyc/${enc(userId)}/review`, { decision, notes }); },
    adminChannelCauses(status = "submitted") { return request<{ causes: Array<CauseView & { ownerName: string; channelHandle: string }> }>(`/v1/admin/channels/causes${q({ status })}`); },
    adminReviewCause(id: string, decision: "approve" | "reject", reason?: string) { return send<{ ok: true }>("POST", `/v1/admin/channels/causes/${enc(id)}/review`, { decision, reason }); },
    adminFreezeCause(id: string, frozen: boolean, reason?: string) { return send<{ ok: true }>("POST", `/v1/admin/channels/causes/${enc(id)}/freeze`, { frozen, reason }); },
    adminRefundCause(id: string, reason: string) { return send<{ refunded: number }>("POST", `/v1/admin/channels/causes/${enc(id)}/refund-all`, { reason }); },
    adminChannelWithdrawals() {
      return request<{ withdrawals: Array<{ id: string; userName: string; phone: string; amountUgx: number; status: string; network: string | null; environment: string; createdAt: string }> }>("/v1/admin/channels/withdrawals");
    },
    adminVoidPoints(userId: string, points: number, reason: string) { return send<{ ok: true }>("POST", "/v1/admin/channels/points/void", { userId, points, reason }); },
  };
}
