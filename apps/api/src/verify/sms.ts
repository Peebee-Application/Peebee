/**
 * Africa's Talking — SMS delivery for onboarding verification codes, using
 * carrier-direct Uganda/East Africa routes (MTN/Airtel) instead of a
 * global aggregator. https://developers.africastalking.com/docs/sms/sending
 *
 * AFRICASTALKING_USERNAME="sandbox" talks to the sandbox API and only
 * delivers to numbers registered as simulator recipients in the dashboard —
 * useful for testing the integration before going live with a real app.
 */

function username(): string {
  const value = process.env.AFRICASTALKING_USERNAME;
  if (!value) throw new Error("AFRICASTALKING_USERNAME is not set");
  return value;
}

function apiKey(): string {
  const key = process.env.AFRICASTALKING_API_KEY;
  if (!key) throw new Error("AFRICASTALKING_API_KEY is not set");
  return key;
}

function baseUrl(): string {
  return username() === "sandbox" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com";
}

export function isAfricasTalkingConfigured(): boolean {
  try {
    username();
    apiKey();
    return true;
  } catch {
    return false;
  }
}

export async function sendVerificationSms(to: string, code: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/version1/messaging`, {
    method: "POST",
    headers: {
      apiKey: apiKey(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      username: username(),
      to,
      message: `Your Peebee verification code is ${code}. It expires in 10 minutes.`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Africa's Talking send failed: ${res.status} ${await res.text()}`);
  }
}
