export type AttentionParty = {
  userId: string;
  role: "customer" | "rider" | "business" | "taxi";
  label: string;
  name: string;
  restaurantId?: string;
  storeId?: string;
};
export type AttentionSettings = {
  enabled: boolean;
  maxHoldSeconds: number;
  cooldownSeconds: number;
  pollMilliseconds: number;
  leaseMilliseconds: number;
  arrivalEnabled: boolean;
  holdDelayMilliseconds: number;
  arrivalRadiusMeters: number;
};
export const DEFAULT_ATTENTION_SETTINGS: AttentionSettings = {
  enabled: true, maxHoldSeconds: 20, cooldownSeconds: 3,
  arrivalRadiusMeters: 40, holdDelayMilliseconds: 300, pollMilliseconds: 500, leaseMilliseconds: 1500, arrivalEnabled: true,
};
export type AttentionSignal = {
  id: string; orderId: string; senderName: string; senderId: string;
  reason: string; mode: "tap" | "hold"; expiresAt: number;
};
export type FollowUpMessage = { id: string; senderId: string; body: string; createdAt: number };
export type FollowUpMessagePreview = { orderId: string; senderId: string; senderName: string };
