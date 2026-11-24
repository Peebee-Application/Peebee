/**
 * Resend — transactional email for onboarding verification codes.
 * https://resend.com/docs/api-reference/emails/send-email
 *
 * Until a custom domain is verified in the Resend dashboard, the sandbox
 * `onboarding@resend.dev` sender can only deliver to the Resend account's
 * own email address — real users' inboxes won't receive anything until a
 * domain is added and RESEND_FROM is set to an address on it.
 */

import { emailProviderConfigured, sendResendEmail } from "./email-keys.js";

/** Where the app's own logo is hosted — email clients load images over
 * plain HTTP(S), not from the local bundle, so this has to be a real URL.
 * PNG, not SVG: Gmail and Outlook don't render SVG images in email. */
function logoUrl(): string {
  return process.env.CUSTOMER_APP_URL_LOGO ?? "https://app.peebee.online/brand/peebee-logo-light.png";
}

export const isResendConfigured = emailProviderConfigured;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Email clients ignore CSS variables and external stylesheets, so the app's
// tokens (white surface, ink text, gold accent, 24px card radius, faint
// border, soft shadow — see apps/customer/app/globals.css) are inlined here.
const C = { page: "#F5F5F5", card: "#FFFFFF", ink: "#0A0A0A", muted: "#5C6670", gold: "#C9A227", border: "#E9E9E8", soft: "#F5F5F5" };
const FONT = "'Google Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Shared Peebee email shell: logo, white card, gold pill CTA, quiet footer.
 * `preheader` is the grey preview text shown beside the subject in an inbox. */
function emailShell(opts: { preheader: string; title: string; intro: string; body: string; footer: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeHtml(opts.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${C.page};font-family:${FONT};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(opts.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
            <tr>
              <td align="center" style="padding-bottom:20px;">
                <img src="${logoUrl()}" alt="Peebee" width="56" height="56" style="display:block;width:56px;height:56px;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="background:${C.card};border:1px solid ${C.border};border-radius:24px;padding:36px 32px;box-shadow:0 4px 16px rgba(10,10,10,0.06);">
                <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:${C.ink};text-align:center;">${escapeHtml(opts.title)}</h1>
                <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:${C.muted};text-align:center;">${opts.intro}</p>
                ${opts.body}
              </td>
            </tr>
            <tr>
              <td style="padding-top:24px;font-size:12px;line-height:1.6;color:${C.muted};text-align:center;">
                ${opts.footer}
                <br />© Peebee
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="padding-bottom:28px;">
                      <a href="${escapeHtml(href)}" style="display:inline-block;background:${C.gold};color:${C.ink};font-weight:700;font-size:15px;text-decoration:none;padding:14px 32px;border-radius:999px;">${escapeHtml(label)}</a>
                    </td>
                  </tr>
                </table>`;
}

/** The six digits sit in ONE soft panel, so the code reads as a single block
 * and survives long-press select-all/copy. */
function codePanel(code: string): string {
  const spaced = code.split("").map(escapeHtml).join("&nbsp;");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="background:${C.soft};border-radius:16px;padding:18px 12px;">
                      <span style="font-size:32px;line-height:1;font-weight:700;letter-spacing:10px;color:${C.ink};font-family:'SF Mono',Menlo,Consolas,monospace;">${spaced}</span>
                    </td>
                  </tr>
                </table>`;
}

/** Branded HTML verification email — a card with the logo, a short
 * instruction, a one-tap "Verify Email Address" button (when a link is
 * available) and the 6-digit code as a fallback for typing it in by hand.
 * Password-reset emails (no link) are code-only and worded for a reset. */
export function buildEmailHtml(code: string, verifyLink?: string, purpose: "verify" | "reset" = "verify", ttlMinutes = 10): string {
  const expiry = `<p style="margin:20px 0 0;font-size:12px;color:${C.muted};text-align:center;">This code expires in ${ttlMinutes} minutes.</p>`;
  if (purpose === "reset") {
    return emailShell({
      preheader: `Your Peebee password reset code is ${code}`,
      title: "Reset your password",
      intro: "Enter this code in the app to choose a new password.",
      body: `${codePanel(code)}${expiry}`,
      footer: "If you didn't ask to reset your password, you can safely ignore this email — your password won't change.",
    });
  }
  return emailShell({
    preheader: verifyLink ? "Tap to verify your email and finish setting up Peebee" : `Your Peebee verification code is ${code}`,
    title: "Verify your email address",
    intro: verifyLink
      ? "Tap the button below to confirm it's you and finish setting up your Peebee account."
      : "Enter this code in the app to confirm your email address.",
    body: `${verifyLink ? `${ctaButton(verifyLink, "Verify Email Address")}
                <p style="margin:0 0 12px;font-size:12px;color:${C.muted};text-align:center;">Or enter this code instead:</p>` : ""}
                ${codePanel(code)}${expiry}`,
    footer: "If you didn't request this, you can safely ignore this email.",
  });
}

function buildEmailText(code: string, verifyLink?: string, purpose: "verify" | "reset" = "verify", ttlMinutes = 10): string {
  if (purpose === "reset") {
    return `Your Peebee password reset code is ${code}. It expires in ${ttlMinutes} minutes. If you didn't ask to reset your password, ignore this email.`;
  }
  return verifyLink
    ? `Verify your Peebee account: ${verifyLink}\n\nOr enter this code: ${code}\n\nExpires in ${ttlMinutes} minutes. If you didn't request this, ignore this email.`
    : `Your Peebee verification code is ${code}. It expires in ${ttlMinutes} minutes. If you didn't request this, ignore this email.`;
}

/** `verifyLink`, when given, is a one-click confirmation URL (email
 * channel, onboarding "verify" purpose only) — clicking it verifies the
 * account with no code entry needed; the code is still shown as a
 * fallback. Password-reset emails omit it and are code-only. */
export async function sendVerificationEmail(
  to: string,
  code: string,
  verifyLink?: string,
  purpose: "verify" | "reset" = "verify",
  ttlMinutes = 10,
): Promise<void> {
  await sendResendEmail({
    to: [to],
    subject: purpose === "reset" ? "Your Peebee password reset code" : "Verify your Peebee account",
    html: buildEmailHtml(code, verifyLink, purpose, ttlMinutes),
    text: buildEmailText(code, verifyLink, purpose, ttlMinutes),
  });
}

/** Branded "you've been invited" email for a new staff account — the
 * temporary password shown here stops working the moment they set their
 * own (requireAuth blocks everything else in the meantime), so there's no
 * separate expiry to manage here the way the OTP codes above need one. */
export function buildStaffInviteHtml(name: string, roleLabel: string, tempPassword: string, loginUrl: string): string {
  return emailShell({
    preheader: "You've been invited to the Peebee admin portal",
    title: "You've been added to Peebee",
    intro: `Hi ${escapeHtml(name)} — you've been invited to the Peebee admin portal as <strong style="color:${C.ink};">${escapeHtml(roleLabel)}</strong>.`,
    body: `<p style="margin:0 0 8px;font-size:12px;color:${C.muted};text-align:center;">Your temporary password</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                  <tr>
                    <td align="center" style="background:${C.soft};border-radius:16px;padding:16px 12px;">
                      <span style="font-size:18px;font-weight:700;letter-spacing:1px;color:${C.ink};font-family:'SF Mono',Menlo,Consolas,monospace;">${escapeHtml(tempPassword)}</span>
                    </td>
                  </tr>
                </table>
                ${ctaButton(loginUrl, "Log in")}
                <p style="margin:0;font-size:12px;line-height:1.6;color:${C.muted};text-align:center;">
                  You'll be asked to set your own password the moment you log in — nothing else in the portal is reachable until you do.
                </p>`,
    footer: "If you weren't expecting this, you can ignore this email.",
  });
}

function buildStaffInviteText(name: string, roleLabel: string, tempPassword: string, loginUrl: string): string {
  return `Hi ${name} — you've been invited to the Peebee admin portal as ${roleLabel}.\n\nTemporary password: ${tempPassword}\n\nLog in: ${loginUrl}\n\nYou'll be asked to set your own password immediately — nothing else works until you do.`;
}

export async function sendStaffInviteEmail(
  to: string,
  name: string,
  roleLabel: string,
  tempPassword: string,
  loginUrl: string,
): Promise<void> {
  await sendResendEmail({
    to: [to],
    subject: "You've been added to the Peebee admin portal",
    html: buildStaffInviteHtml(name, roleLabel, tempPassword, loginUrl),
    text: buildStaffInviteText(name, roleLabel, tempPassword, loginUrl),
  });
}
