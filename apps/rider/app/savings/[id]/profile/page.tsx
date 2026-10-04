"use client";

import { UGANDA_DISTRICTS, type StageMemberProfile } from "@peebee/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";

/** RSLA membership profile — nationality, district, gender, date of birth,
 * household size, literacy. Separate from the rider's core Peebee profile
 * (see migration 0062_stage_member_profile.sql for why): these matter for
 * the savings association's own records, not for Peebee's own rider
 * verification. */
export default function StageMemberProfilePage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const router = useRouter();
  const [profile, setProfile] = useState<StageMemberProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [nationality, setNationality] = useState("");
  const [district, setDistrict] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female" | "other">("");
  const [dob, setDob] = useState("");
  const [householdSize, setHouseholdSize] = useState("");
  const [literate, setLiterate] = useState<"" | "0" | "1">("");

  useEffect(() => {
    api
      .getMyStageMemberProfile(stageId)
      .then((p) => {
        setProfile(p);
        setNationality(p.nationality ?? "");
        setDistrict(p.district ?? "");
        setGender((p.gender as "male" | "female" | "other" | null) ?? "");
        setDob(p.date_of_birth ?? "");
        setHouseholdSize(p.household_size != null ? String(p.household_size) : "");
        setLiterate(p.literate != null ? (String(p.literate) as "0" | "1") : "");
      })
      .catch((err) => setError(errorMessage(err)));
  }, [stageId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateMyStageMemberProfile(stageId, {
        nationality: nationality.trim() || null,
        district: district || null,
        gender: gender || null,
        date_of_birth: dob || null,
        household_size: householdSize ? Number(householdSize) : null,
        literate: literate === "" ? null : (Number(literate) as 0 | 1),
      });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!profile && error) return <div className="p-4 text-sm text-red-700">{error}</div>;
  if (!profile) return <div className="p-4 text-sm text-ink-500">Loading…</div>;

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <div>
        <h1 className="text-xl font-bold text-ink">RSLA membership profile</h1>
        <p className="text-sm text-ink-500">
          A few extra details the association keeps on file. Your phone, name, and photo already come from your
          Peebee rider profile.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved && <p className="rounded-lg bg-green/10 px-3 py-2 text-sm text-green">Saved.</p>}

      <form onSubmit={save} className="home-card space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500" htmlFor="nationality">
            Nationality
          </label>
          <input
            id="nationality"
            value={nationality}
            onChange={(e) => setNationality(e.target.value)}
            placeholder="e.g. Ugandan"
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500" htmlFor="district">
            District
          </label>
          <select
            id="district"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          >
            <option value="">Select a district…</option>
            {UGANDA_DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500" htmlFor="gender">
            Gender
          </label>
          <select
            id="gender"
            value={gender}
            onChange={(e) => setGender(e.target.value as "" | "male" | "female" | "other")}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          >
            <option value="">Select…</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500" htmlFor="dob">
            Date of birth
          </label>
          <input
            id="dob"
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500" htmlFor="household">
            Household size
          </label>
          <input
            id="household"
            inputMode="numeric"
            value={householdSize}
            onChange={(e) => setHouseholdSize(e.target.value.replace(/[^\d]/g, ""))}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500" htmlFor="literate">
            Can read and write?
          </label>
          <select
            id="literate"
            value={literate}
            onChange={(e) => setLiterate(e.target.value as "" | "0" | "1")}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          >
            <option value="">Select…</option>
            <option value="1">Yes</option>
            <option value="0">No</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </form>

      <button type="button" onClick={() => router.back()} className="w-full py-2 text-center text-xs font-semibold text-ink-500">
        Back
      </button>
    </div>
  );
}
