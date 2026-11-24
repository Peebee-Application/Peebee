# Taxibee future departures

Future departures are published staff slots for an approved TaxiPress taxi and
active fixed route. They use Peebee's shared orders, payments, wallet, identity,
notifications, Admin activity log and D1 database. They do not create preview
traffic or reserve today's physical stage queue.

## Enable and operate

1. Apply `apps/api/src/db/migrations/0172_taxipress_scheduled_departures.sql`
   to the existing shared D1 database after migrations through `0171`.
2. In Admin → Taxipress → Settings, enable Future departures and set the
   advance window, lead notice, booking cutoff, driver check-in and grace
   windows, taxi spacing and passenger cancellation terms. The feature defaults
   off.
3. Approve the taxi and its route as usual. In Admin → Taxipress → Departures,
   publish a date/time. Route fare and taxi capacity are snapshotted at publish
   time; slots that overlap the configured taxi turnaround are rejected.
4. Customers browse public slots and reserve passenger seats. The server
   atomically holds slot capacity. Booking creates a real Peebee order and uses
   wallet, mobile money, corporate credit or a funded voucher at the regular
   checkout. Cash is not offered for advance reservations.
5. The assigned driver checks in from the existing Partner → Taxipress screen.
   Check-in requires the usual live taxi and physical-stage checks, and is only
   available in the configured window. It creates the physical queue entry and
   converts reserved passengers into ordinary TaxiPress bookings, including
   automatic numbered-seat allocation where that taxi has an approved map.
6. Regular boarding, ticket checks, settlement, cancellation and arrival then
   use the established queue and booking services. If staff cancel a published
   slot, collected payments are refunded to the customer's Peebee wallet.
   Unchecked-in departures past their grace period are cancelled and refunded
   by the API's scheduled sweep; a provider payment still pending is reconciled
   before the ticket is closed.

Future bookings support passenger and child counts, configured luggage,
assistance, language and traveller details. Seat numbers are assigned when the
driver checks in because a published future slot is not yet a physical seat map.
Return bundles and open tickets are not sold against future slots; they remain
available only through the current-departure flows. Practice mode remains the
isolated replica and is not connected to these endpoints.

The D1 migration is applied manually; deployment does not apply schema changes.
The API checks the migration and leaves scheduling unavailable until it exists.
The live sale switch also remains off until staff choose to enable it.
