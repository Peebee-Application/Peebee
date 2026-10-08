import { isAdminRole } from "@peebee/shared";

type UserRow = {
  id: string;
  phone: string | null;
  email: string | null;
  name: string;
  role: "customer" | "rider" | "admin";
  phone_verified_at: string | null;
  email_verified_at: string | null;
  default_matching_mode: string | null;
  password_set_at: string | null;
  admin_role: string | null;
  force_password_change: number | null;
  profile_photo_key: string | null;
  account_code?: string | null;
};

/** Shapes a raw `users` row into the public `AuthUser` DTO. */
export function toAuthUser(row: Record<string, unknown>) {
  const r = row as unknown as UserRow;
  return {
    id: r.id,
    accountCode: r.account_code ?? null,
    phone: r.phone,
    email: r.email ?? null,
    name: r.name,
    role: r.role,
    phoneVerifiedAt: r.phone_verified_at ?? null,
    emailVerifiedAt: r.email_verified_at ?? null,
    defaultMatchingMode: r.default_matching_mode ?? null,
    // False only for a Google-only account that has never reset its
    // password — the random value set at creation was never shown to
    // anyone, so "change password" would have nothing to check it against.
    passwordSet: r.password_set_at != null,
    adminRole: isAdminRole(r.admin_role) ? r.admin_role : null,
    forcePasswordChange: r.force_password_change === 1,
    hasProfilePhoto: r.profile_photo_key != null,
  };
}
