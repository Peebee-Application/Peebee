import test from 'node:test';
import assert from 'node:assert/strict';
import { priceBooking } from './details.js';
import { DEFAULT_LUGGAGE_PRICES } from './settings.js';

const settings = { maxLapChildren: 2, childSeatFarePercent: 37, luggageEnabled: true, luggageOptionsShown: 6, luggagePrices: DEFAULT_LUGGAGE_PRICES };
test('a parent may buy seats for children who could travel on a lap; admin prices each seat', () => {
  const result = priceBooking({ adults: 1, children: 2, childSeats: 2, luggage: { standard: 1 } }, 5001, settings);
  assert.equal(result.error, null);
  assert.equal(result.seats, 3);
  assert.equal(result.childSeats, 2);
  assert.equal(result.fareAmount, 8701);
  assert.equal(result.amount, 10701);
});
test('older clients retain the admin lap allowance when they omit child seats', () => {
  assert.equal(priceBooking({ adults: 1, children: 3, luggage: {} }, 5000, settings).childSeats, 1);
  assert.equal(priceBooking({ adults: 1, children: 3, luggage: {} }, 5000, { ...settings, maxLapChildren: 0 }).childSeats, 3);
});
test('a requested allocation cannot exceed child count or evade the lap policy', () => {
  for (const childSeats of [-1, 0, 0.5, 4, NaN]) {
    assert.ok(priceBooking({ adults: 1, children: 3, childSeats, luggage: {} }, 5000, settings).error);
  }
});
