-- Migration 0108: station withdrawals belong to live or sandbox, like the fuel sales they pay out.
-- Additive only; the code checks for this column first.

-- Sandbox sales are paid out as simulated withdrawals and never reach the admin's payout
-- queue; a station's live balance only counts live withdrawals.
ALTER TABLE fuel_station_withdrawals ADD COLUMN environment TEXT NOT NULL DEFAULT 'live';
