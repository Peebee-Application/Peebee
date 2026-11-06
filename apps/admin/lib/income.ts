import { adminRequest } from "./admin-request";

export type IncomeRange = "today" | "week" | "month" | "all";
export type IncomeStream = { key: string; group: string; label: string; kind: string; how: string; href: string | null; amount: number | null; count: number | null; partial?: boolean };
export type Income = { environment: string; groups: { id: string; label: string }[]; streams: IncomeStream[] };
type Report = { available: boolean; byModule: { module: string; platform_net: number; orders: number }[] };

/** Income streams that the money-flow report already totals, by its module keys. */
const FROM_REPORT: Record<string, string[]> = {
  ride_boda: ["ride_boda"], delivery: ["delivery_parcel", "delivery_shopping"], food: ["food"],
  marketplace: ["marketplace"], pharmacy: ["pharmacy"], gas: ["gas"], services: ["services"],
};

const DAYS: Record<IncomeRange, number> = { today: 1, week: 7, month: 30, all: 3650 };

export type IncomeRow = IncomeStream & { value: number | null };

/**
 * Every income stream with its figure for a period: from the platform's own tables and ledger where the stream is
 * recorded there, otherwise from the money-flow report. A stream with neither has no figure (null), never a made-up zero.
 * The Income page and the Overview both use this, so their totals always agree.
 */
export async function loadIncome(range: IncomeRange): Promise<{ income: Income; rows: IncomeRow[]; total: number; counted: number }> {
  const [income, report] = await Promise.all([
    adminRequest<Income>(`/admin/platform/income?range=${range}`),
    adminRequest<Report>(`/admin/money-flow/report?days=${DAYS[range]}`).catch(() => null),
  ]);
  const rows = income.streams.map((s): IncomeRow => {
    if (s.amount != null) return { ...s, value: s.amount };
    const keys = FROM_REPORT[s.key];
    if (!keys || !report?.available) return { ...s, value: null };
    // A module with no row in the report may have no orders in this period, or not be reported there at all: either way
    // it is "not totalled" rather than a made-up zero.
    const found = report.byModule.filter((m) => keys.includes(m.module));
    return { ...s, value: found.length ? found.reduce((sum, m) => sum + m.platform_net, 0) : null };
  });
  return { income, rows, total: rows.reduce((sum, r) => sum + (r.value ?? 0), 0), counted: rows.filter((r) => r.value != null).length };
}
