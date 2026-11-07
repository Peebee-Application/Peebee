"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
type Permission = Awaited<
  ReturnType<typeof api.learningCreatorPermissions>
>["permissions"][number];
const field =
  "w-full rounded-xl border border-[var(--border-faint)] p-3 text-sm text-ink";
export function LearningCreatorPermissions({
  canManage,
}: {
  canManage: boolean;
}) {
  const [permissions, setPermissions] = useState<Permission[]>([]),
    [userId, setUserId] = useState(""),
    [schoolId, setSchoolId] = useState(""),
    [permission, setPermission] = useState("publish"),
    [evidence, setEvidence] = useState(""),
    [active, setActive] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(
    () =>
      api
        .learningCreatorPermissions()
        .then((r) => setPermissions(r.permissions)),
    [],
  );
  useEffect(() => {
    if (canManage) load().catch((e) => setError(errorMessage(e)));
  }, [canManage, load]);
  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5">
      <h2 className="text-lg font-semibold text-ink">
        Learning creators and verified reviewers
      </h2>
      <p className="text-sm text-ink-500">
        Check identity, age/guardian eligibility where applicable, content
        rights and seller requirements before granting publication or sales.
        Reviewer approval requires relevant educator competence. School approval
        also requires institutional authority. These permissions do not replace
        course-specific review.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api.setLearningCreatorPermission({
              userId,
              schoolId,
              permission,
              evidence,
              active,
            });
            await load();
            setNotice("Permission saved and recorded in the activity log.");
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="text-xs font-semibold">
          Peebee user ID
          <input
            className={field}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
          />
        </label>
        <label className="text-xs font-semibold">
          School ID (blank for platform scope)
          <input
            className={field}
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
          />
        </label>
        <label className="text-xs font-semibold">
          Permission
          <select
            className={field}
            value={permission}
            onChange={(e) => setPermission(e.target.value)}
          >
            <option value="publish">Publish content</option>
            <option value="sell">Sell content</option>
            <option value="review">Verified educator review</option>
            <option value="school_approve">Approve school publication</option>
          </select>
        </label>
        <label className="text-xs font-semibold">
          Decision
          <select
            className={field}
            value={active ? "grant" : "revoke"}
            onChange={(e) => setActive(e.target.value === "grant")}
          >
            <option value="grant">Grant</option>
            <option value="revoke">Revoke</option>
          </select>
        </label>
        <label className="text-xs font-semibold sm:col-span-2">
          Verification basis / decision reason
          <textarea
            className={field}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            minLength={5}
            required
          />
        </label>
        <button
          disabled={!canManage || busy}
          className="min-h-11 rounded-xl bg-gold px-4 py-2 text-sm font-semibold text-ink-gold disabled:opacity-50"
        >
          Save permission
        </button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-2">Person</th>
              <th className="p-2">Permission</th>
              <th className="p-2">Scope</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {permissions.map((p) => (
              <tr key={`${p.user_id}-${p.permission}-${p.school_id}`}>
                <td className="p-2">{p.name}</td>
                <td className="p-2">{p.permission}</td>
                <td className="p-2">{p.school_id || "Platform"}</td>
                <td className="p-2">{p.active ? "Active" : "Revoked"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
