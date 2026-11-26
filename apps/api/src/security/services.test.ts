import test from "node:test";
import assert from "node:assert/strict";
import { addAdmin, addUser, anonymous, app, freshDatabase } from "../test-support/db.js";
import { setPlatformEnvironment } from "../lib/settings.js";
import { setSmsSenderForTests } from "../lib/sms-gateway.js";
import { finalizeRefund, settlePayment } from "../services-platform/payments.js";
import { splitCollected, weekdayOf } from "../services-platform/engine.js";

const json = async (res: Response) => (await res.json()) as any;
type Db = Awaited<ReturnType<typeof freshDatabase>>;

const futureDate = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const CUSTOMER = "+256772123456"; // an MTN number

async function setup(offering: Record<string, unknown> = { title: "Consult", price_ugx: 100000, deposit_ugx: 0 }) {
  setSmsSenderForTests(async () => ({ status: "sent" }) as never);
  const client = await freshDatabase();
  await setPlatformEnvironment("sandbox");
  const admin = await addAdmin(client);
  await admin.setOptions({ services_booking_verification: "rate_limit_only" });
  const token = await addUser(client, "u_svc_owner");
  const call = (path: string, method = "GET", body?: object) =>
    app.request(`/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const business = (await json(await call("/services-platform/my-business", "POST", { name: "Acme Advisory", category: "consultation", phone: "+256700123456" }))).business;
  await client.execute("UPDATE service_businesses SET status = 'active'");
  const made = (await json(await call("/services-platform/offerings", "POST", offering))).offering;
  const book = (body: object = {}) =>
    anonymous(`/services-platform/public/${business.slug}/book`, "POST", {
      service_id: made.id, customer_name: "Carol", customer_phone: CUSTOMER, scheduled_date: futureDate(5), scheduled_time: "10:00", payment_rail: "momo_mtn", ...body,
    });
  const bookingRow = async (id: string) => (await client.execute({ sql: "SELECT * FROM service_bookings WHERE id = ?", args: [id] })).rows[0] as any;
  const wallet = async () => Number((await client.execute({
    sql: "SELECT balance FROM provider_wallets WHERE provider_type='service' AND provider_id=? AND environment='sandbox'",
    args: [business.id],
  })).rows[0]?.balance ?? 0);
  const payments = async (id: string) => (await client.execute({ sql: "SELECT * FROM service_payments WHERE booking_id = ? ORDER BY created_at, id", args: [id] })).rows as any[];
  return { client, admin, call, business, offering: made, book, bookingRow, wallet, payments };
}

async function bookAndPay(s: Awaited<ReturnType<typeof setup>>, body: object = {}) {
  const res = await s.book(body);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const out = await json(res);
  const [p] = await s.payments(out.booking.id);
  await settlePayment(p.id);
  return { out, id: out.booking.id as string, code: out.booking.code as string, paymentId: p.id as string };
}

test("slots: only open hours are offered, taken times disappear, and a closed day offers nothing", async () => {
  const s = await setup({ title: "Consult", price_ugx: 50000, duration_minutes: 60, buffer_minutes: 0 });
  const admin = s.admin;
  await admin.setOptions({ services_availability_mode: "weekly_schedule_with_slots" });
  const date = futureDate(6);
  const weekday = weekdayOf(date);
  const put = await s.call("/services-platform/hours", "PUT", { hours: [{ weekday, open_time: "09:00", close_time: "12:00" }] });
  assert.equal(put.status, 200);
  const overlap = await s.call("/services-platform/hours", "PUT", { hours: [{ weekday, open_time: "09:00", close_time: "12:00" }, { weekday, open_time: "11:00", close_time: "13:00" }] });
  assert.equal(overlap.status, 400, "overlapping windows are refused");

  const slotsUrl = `/services-platform/public/${s.business.slug}/slots?service_id=${s.offering.id}&from=${date}&days=1`;
  const open = await json(await anonymous(slotsUrl));
  assert.deepEqual(open.slots.map((x: any) => x.time), ["09:00", "10:00", "11:00"]);

  const first = await s.book({ scheduled_date: date, scheduled_time: "10:00", payment_rail: "cash_at_venue" });
  assert.equal(first.status, 200);
  const second = await s.book({ scheduled_date: date, scheduled_time: "10:00", payment_rail: "cash_at_venue", customer_phone: "+256772999999" });
  assert.equal(second.status, 409, "one seat, one booking");
  assert.deepEqual((await json(await anonymous(slotsUrl))).slots.map((x: any) => x.time), ["09:00", "11:00"]);
  assert.equal((await s.book({ scheduled_date: date, scheduled_time: "15:00", payment_rail: "cash_at_venue" })).status, 409, "outside opening hours");

  assert.equal((await s.call("/services-platform/blackouts", "POST", { date, reason: "Holiday" })).status, 200);
  assert.deepEqual((await json(await anonymous(slotsUrl))).slots, []);
  assert.equal((await s.book({ scheduled_date: date, scheduled_time: "09:00", payment_rail: "cash_at_venue" })).status, 409);
});

test("the unique seat index refuses a double booking even if the checks are skipped", async () => {
  const s = await setup();
  const a = await json(await s.book({ payment_rail: "cash_at_venue" }));
  const row = await s.bookingRow(a.booking.id);
  await s.client.execute({ sql: "UPDATE service_bookings SET slot_seat = 1 WHERE id = ?", args: [a.booking.id] });
  const b = await json(await s.book({ payment_rail: "cash_at_venue", customer_phone: "+256772999999", scheduled_time: "11:00" }));
  await s.client.execute({ sql: "UPDATE service_bookings SET slot_seat = 1, starts_at = ? WHERE id = ?", args: [row.starts_at, b.booking.id] }).then(
    () => assert.fail("two active bookings took the same seat"),
    (err) => assert.match(String(err.message), /UNIQUE|constraint/i),
  );
});

test("a booking moves through a fixed set of steps and a finished one stays finished", async () => {
  const s = await setup();
  const { booking } = await json(await s.book({ payment_rail: "cash_at_venue" }));
  const patch = (status: string) => s.call(`/services-platform/bookings/${booking.id}/status`, "PATCH", { status });
  assert.equal((await patch("completed")).status, 409, "pending can't jump to completed");
  assert.equal((await patch("confirmed")).status, 200);
  assert.equal((await patch("in_progress")).status, 200);
  assert.equal((await patch("completed")).status, 200);
  assert.equal((await patch("cancelled")).status, 409, "completed is final");
  assert.equal((await patch("pending")).status, 409);

  const stranger = await addUser(s.client, "u_svc_stranger");
  const res = await app.request(`/v1/services-platform/bookings/${booking.id}/status`, { method: "PATCH", headers: { Authorization: `Bearer ${stranger}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) });
  assert.equal(res.status, 404, "another provider can't touch it");
});

test("escrow: paid only when the provider confirms, held until the service is done, released once", async () => {
  const s = await setup({ title: "Consult", price_ugx: 100000, deposit_ugx: 0 });
  const res = await s.book();
  assert.equal(res.status, 200);
  const out = await json(res);
  assert.equal(out.booking.payment_status, "unpaid");
  assert.equal(out.payment.status, "pending");
  assert.equal((await s.bookingRow(out.booking.id)).paid_ugx, 0, "asking is not paying");

  const [p] = await s.payments(out.booking.id);
  await settlePayment(p.id);
  await settlePayment(p.id); // a second confirmation changes nothing
  const paid = await s.bookingRow(out.booking.id);
  assert.equal(Number(paid.paid_ugx), 100000);
  assert.equal(paid.payment_status, "paid_full");
  assert.equal(await s.wallet(), 0, "the provider is paid when the service is done, not before");

  await s.call(`/services-platform/bookings/${out.booking.id}/status`, "PATCH", { status: "confirmed" });
  await s.call(`/services-platform/bookings/${out.booking.id}/status`, "PATCH", { status: "in_progress" });
  const done = await json(await s.call(`/services-platform/bookings/${out.booking.id}/status`, "PATCH", { status: "completed" }));
  const { payout } = splitCollected(100000, 5);
  assert.equal(done.released_ugx, payout);
  assert.equal(await s.wallet(), payout);
  const again = await s.call(`/services-platform/bookings/${out.booking.id}/status`, "PATCH", { status: "completed" });
  assert.equal(again.status, 200);
  assert.equal(await s.wallet(), payout, "released only once");

  const ledger = await s.client.execute("SELECT transaction_id, SUM(amount) AS total FROM ledger_entries WHERE transaction_id IN (SELECT id FROM ledger_transactions WHERE kind LIKE 'service_%') GROUP BY transaction_id");
  assert.ok(ledger.rows.length >= 2, "the payment and the release are both in the ledger");
  for (const row of ledger.rows) assert.equal(Number(row.total), 0, "every service transaction balances");
});

test("direct mode: the provider is paid as soon as the money arrives", async () => {
  const s = await setup();
  await s.admin.setOptions({ services_online_collection_mode: "momo_direct" });
  const { id } = await bookAndPay(s);
  assert.equal(await s.wallet(), splitCollected(100000, 5).payout);
  assert.equal((await s.bookingRow(id)).payment_status, "paid_full");
});

test("deposit mode asks for the deposit only, and the rest can be paid later", async () => {
  const s = await setup({ title: "Consult", price_ugx: 100000, deposit_ugx: 30000 });
  await s.admin.setOptions({ services_online_collection_mode: "deposit_online_balance_at_venue" });
  const { out, id, code } = await bookAndPay(s);
  assert.equal(out.booking.due_now_ugx, 30000);
  const row = await s.bookingRow(id);
  assert.equal(Number(row.paid_ugx), 30000);
  assert.equal(row.payment_status, "deposit_paid");

  const tooMuch = await s.call(`/services-platform/bookings/${id}/venue-payment`, "POST", { amount_ugx: 80000 });
  assert.equal(tooMuch.status, 400, "can't take more than is owed");
  const cash = await json(await s.call(`/services-platform/bookings/${id}/venue-payment`, "POST", { amount_ugx: 70000 }));
  assert.equal(cash.payment_status, "paid_full");
  assert.ok(code);
});

test("pay-at-venue-only switches online collection off, and the provider can waive a balance", async () => {
  const s = await setup();
  await s.admin.setOptions({ services_online_collection_mode: "pay_at_venue_only" });
  const refused = await s.book();
  assert.equal(refused.status, 400);
  assert.equal((await json(refused)).error, "online_payment_off");
  const { booking } = await json(await s.book({ payment_rail: "cash_at_venue" }));
  assert.equal(booking.payment_status, "unpaid");
  const waived = await json(await s.call(`/services-platform/bookings/${booking.id}/waive`, "POST", {}));
  assert.equal(waived.waived_ugx, 100000);
  assert.equal((await s.bookingRow(booking.id)).payment_status, "waived");
  assert.equal((await s.call(`/services-platform/bookings/${booking.id}/waive`, "POST", {})).status, 409, "nothing left to waive");
});

test("a number on the other network is refused for the chosen rail", async () => {
  const s = await setup();
  const res = await s.book({ payment_rail: "momo_mtn", customer_phone: "+256752123456" });
  assert.equal(res.status, 400);
  assert.equal((await json(res)).error, "rail_mismatch");
});

test("customer cancellation: full refund inside the window, kept money outside it, wrong phone sees nothing", async () => {
  const s = await setup();
  const early = await bookAndPay(s, { scheduled_date: futureDate(7) });
  const lookup = await json(await anonymous(`/services-platform/public/bookings/${early.code}?phone=${encodeURIComponent(CUSTOMER)}`));
  assert.equal(lookup.booking.if_cancelled_now, "full");
  assert.equal((await anonymous(`/services-platform/public/bookings/${early.code}?phone=%2B256772000000`)).status, 404);
  const wrong = await anonymous(`/services-platform/public/bookings/${early.code}/cancel`, "POST", { phone: "+256772000000" });
  assert.equal(wrong.status, 404);

  const cancelled = await json(await anonymous(`/services-platform/public/bookings/${early.code}/cancel`, "POST", { phone: CUSTOMER }));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.refund.state, "pending", "the refund is on its way until the provider confirms it");
  const refund = (await s.payments(early.id)).find((p) => p.kind === "refund");
  assert.equal(refund.kind, "refund");
  assert.equal(Number(refund.amount_ugx), 100000);
  await finalizeRefund(refund.id);
  await finalizeRefund(refund.id);
  const row = await s.bookingRow(early.id);
  assert.equal(row.refund_state, "refunded");
  assert.equal(Number(row.paid_ugx), 0);
  assert.equal(await s.wallet(), 0, "the provider earned nothing from a refunded booking");
  assert.equal((await anonymous(`/services-platform/public/bookings/${early.code}/cancel`, "POST", { phone: CUSTOMER })).status, 409, "already cancelled");

  // Inside the free window (a booking made for tomorrow, window 24h => change the window to 72h).
  await s.admin.setOptions({ services_cancellation_window_hours: 72, services_cancellation_refund_mode: "full_refund_until_x_hours" });
  const late = await bookAndPay(s, { scheduled_date: futureDate(2), scheduled_time: "14:00" });
  const kept = await json(await anonymous(`/services-platform/public/bookings/${late.code}/cancel`, "POST", { phone: CUSTOMER }));
  assert.equal(kept.refund.state, "kept");
  assert.equal(await s.wallet(), splitCollected(100000, 5).payout, "a late cancellation pays the provider");
});

test("a provider who cancels always refunds in full, and a manual-review policy waits for their decision", async () => {
  const s = await setup();
  const a = await bookAndPay(s, { scheduled_date: futureDate(3) });
  const cancel = await json(await s.call(`/services-platform/bookings/${a.id}/status`, "PATCH", { status: "cancelled", reason: "Sick" }));
  assert.equal(cancel.refund.state, "pending");
  assert.equal((await s.payments(a.id)).filter((p) => p.kind === "refund").length, 1);

  await s.admin.setOptions({ services_cancellation_refund_mode: "manual_review" });
  const b = await bookAndPay(s, { scheduled_date: futureDate(9) });
  const review = await json(await anonymous(`/services-platform/public/bookings/${b.code}/cancel`, "POST", { phone: CUSTOMER }));
  assert.equal(review.refund.state, "review");
  assert.equal((await s.payments(b.id)).filter((p) => p.kind === "refund").length, 0, "nothing is sent until the provider decides");
  const decided = await json(await s.call(`/services-platform/bookings/${b.id}/refund-decision`, "POST", { decision: "refund" }));
  assert.equal(decided.ok, true);
  assert.equal((await s.payments(b.id)).filter((p) => p.kind === "refund").length, 1);
  assert.equal((await s.call(`/services-platform/bookings/${b.id}/refund-decision`, "POST", { decision: "keep" })).status, 409, "decided once");
});

test("a failed SMS is recorded honestly, and the price can only be quoted before anything is paid", async () => {
  const s = await setup({ title: "Quote me", price_ugx: 0, deposit_ugx: 0, pricing_type: "custom_quote" });
  setSmsSenderForTests(async () => ({ status: "failed" }) as never);
  const { booking } = await json(await s.book({ payment_rail: "cash_at_venue" }));
  const row = await s.bookingRow(booking.id);
  assert.notEqual(row.customer_sms_status, "sent", "never claim a text was delivered when it wasn't");
  assert.equal((await s.call(`/services-platform/bookings/${booking.id}/quote`, "POST", { total_ugx: 60000 })).status, 200);
  assert.equal(Number((await s.bookingRow(booking.id)).total_price_ugx), 60000);
  await s.call(`/services-platform/bookings/${booking.id}/venue-payment`, "POST", { amount_ugx: 10000 });
  assert.equal((await s.call(`/services-platform/bookings/${booking.id}/quote`, "POST", { total_ugx: 5000 })).status, 409);
});
