export const ONBOARDING_TYPES = ['customer','rider','restaurant','merchant'] as const;
export type OnboardingType = typeof ONBOARDING_TYPES[number];
export type ActivationChannel = 'auto' | 'email' | 'sms' | 'whatsapp';
export type OnboardingInput = {
  requestId: string; accountType: OnboardingType; name: string; email?: string; phone?: string;
  preferredChannel: ActivationChannel; consent: true;
  profile?: Record<string, string | number | undefined>;
};
export type OnboardingRecord = {
  id: string; user_id: string; account_type: OnboardingType | 'agent'; name: string;
  email: string | null; phone: string | null; created_at: string; activated_at: string | null;
  delivery_status: string | null; delivery_channel: string | null;
};
export type OnboardingSettings = {
  enabled: boolean; activationHours: number; resendSeconds: number; maxAttempts: number;
  channels: Array<'email'|'sms'|'whatsapp'>;
  whatsappPhoneId: string; whatsappTemplate: string; whatsappLanguage: string; whatsappVersion: string;
  whatsappTokenSet: boolean; smsUsername: string; smsKeySet: boolean;
  providers: { email: boolean; sms: boolean; whatsapp: boolean };
};
export type SalesAgent = { user_id: string; name: string; email: string | null; phone: string | null; enabled: number; activated_at: string | null };
