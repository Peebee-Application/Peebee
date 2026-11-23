import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDraft, readDraft, saveDraft, BOOKING_DRAFT_KEY } from './booking-draft';

const state = {
  screen: 'checkout', activeTrip: { id: 'queue', routeId: 'route', fare: 5000, seats: 14 },
  passengerCount: 2, childCount: 1, reservedChildSeatsCount: 1, luggageQuantities: { standard: 2 },
  searchFrom: 'Entebbe', searchTo: 'Kampala', bookingDate: '2026-11-23',
  password: 'never-save', token: 'never-save', walletBalance: 70000, accepted: true,
};
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test('anonymous progress survives a reload and sign-in without preserving credentials, prices or consent', () => {
  const s = storage(); saveDraft(s, state, null);
  const saved = s.getItem(BOOKING_DRAFT_KEY)!;
  assert.doesNotMatch(saved, /password|token|never-save|walletBalance|accepted|fare|seats/);
  const draft = readDraft(s, 'new-customer')!;
  assert.equal(draft.queueId, 'queue');
  assert.equal(draft.values.passengerCount, 2);
  assert.deepEqual(draft.values.luggageQuantities, { personal: 0, standard: 2, large: 0, excess: 0, fragile: 0, commercial: 0 });
});
test('an account-owned booking cannot be restored into a different account or an anonymous browser', () => {
  const s = storage(); saveDraft(s, state, 'owner');
  assert.equal(readDraft(s, 'other'), null); assert.equal(readDraft(s, null), null);
  assert.ok(readDraft(s, 'owner'));
});
test('corrupt or tampered storage cannot inject quotes, authorization or arbitrary state', () => {
  const s = storage(); const draft = captureDraft(state, null)!;
  (draft.values as Record<string, unknown>).token = 'injected';
  (draft.values as Record<string, unknown>).fare = 0;
  draft.values.passengerCount = -999;
  s.setItem(BOOKING_DRAFT_KEY, JSON.stringify(draft));
  const restored = readDraft(s, null)!;
  assert.equal(restored.values.passengerCount, 1);
  assert.equal('token' in restored.values, false); assert.equal('fare' in restored.values, false);
  s.setItem(BOOKING_DRAFT_KEY, '{broken'); assert.equal(readDraft(s, null), null);
});
