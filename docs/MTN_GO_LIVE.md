# MTN MoMo: from the sandbox to real money

Peebee talks to MTN directly (no aggregator). This page says what is already built, what has to change on the Peebee
side to take real money, and, plainly, what is **not known** and has to come from MTN.

## What is built and tested in MTN's sandbox

Verified end to end on the live platform against MTN's sandbox (no real money, no phone prompt):

1. A customer's payment goes to **MTN Collections** (`RequestToPay`) and comes back `successful`.
2. The ride settles and the rider's earnings land in the rider's wallet.
3. The rider's withdrawal goes out through **MTN Disbursements** (`Transfer`) and ends `successful`.

Code: `apps/api/src/payments/mtn/wire.ts` (the MTN calls) and `apps/api/src/payments/credentials.ts` (the fields).

How it works today, so nothing here comes as a surprise:

- **Two MTN products, two sets of credentials.** Collections and Disbursements each have their own subscription key and
  can have their own API user and key. MTN approves them separately, so Peebee only treats MTN as configured once both
  subscription keys are saved.
- **Where credentials live.** Admin → Settings → Payments → "MTN MoMo (direct) API credentials". They are stored
  encrypted in the database. Environment variables (`MOMO_*`, listed in `infra/ENV.md`) are only a fallback.
- **Status is polled, not called back.** Peebee sends no callback URL to MTN. A payment's result is picked up by the
  background reconciliation that runs every 2 minutes; a withdrawal's result is picked up while the rider's (or
  customer's) Wallet screen is open. So no public callback address is needed.
- **Number format.** Numbers are sent to MTN in international form without a plus (`2567…`). Only MTN numbers are routed
  to MTN; Airtel numbers are detected and not sent here.
- **Amounts.** Peebee rounds amounts to whole UGX 500s by an admin rule, so MTN always receives whole numbers.

## What is different in the sandbox (and changes in production)

| | Sandbox (today) | Production |
|---|---|---|
| Currency sent to MTN | `EUR` (MTN's sandbox accepts nothing else; the adapter switches to it automatically) | The order's own currency, `UGX` |
| Customer's phone | Nothing happens. MTN's test system marks the payment successful by itself | MTN pushes a **PIN prompt** to the customer's phone and the payment waits for them to approve |
| Money | None moves | Real |
| Keys | Created by you with MTN's sandbox calls | Issued by MTN after Go-Live (see "Unknown" below) |

## Switching Peebee to production

Do these in order. Nothing here is irreversible, and the rollback is at the end.

1. **Get production access and keys from MTN** (the Go-Live process; see "Unknown" below). You need, for **both**
   Collections and Disbursements: the subscription key, the API user and the API key.
2. **Set the production base URL** on the API worker. The adapter reads `MOMO_BASE_URL` and defaults to MTN's sandbox
   host, so until this is set Peebee keeps talking to the sandbox whatever else is configured. Use MTN's production host
   for your country (to confirm with MTN; do not guess). Set it as a Worker **secret**, so a later deploy does not
   overwrite it:

   ```bash
   cd apps/api
   wrangler secret put MOMO_BASE_URL
   ```

3. **Enter the production credentials** in Admin → Settings → Payments → MTN MoMo (direct). Leave a field blank to keep
   what is saved. The disbursement user/key fields can stay blank only if MTN issued one API user for both products.
4. **Set the Environment field** on the same card to the production value MTN specifies. The default is `sandbox`;
   anything else makes Peebee send real amounts in UGX instead of EUR. (MTN's production target environment is
   country-specific. Confirm the exact text with MTN.)
5. **Check the platform switches** (Admin → Platform state and Admin → Settings → Payments): platform **Live**, payments
   **demo mode off**, MTN **active** and first in the provider order.
6. **Make the first real payments small and deliberate** (see the test plan below) before any customer does it.

**Rollback, in seconds:** untick MTN under Admin → Settings → Payments. New payments then fail with a clear message and
nobody is charged. **Do not turn Payments demo mode on once real customers are paying**: every payment would go through
the simulator, so orders could show as paid while no money moved. (Demo mode is for testing before launch, and for
pulling a sandbox platform back to demo.) You can also set the card's Environment back to `sandbox` and remove the
`MOMO_BASE_URL` secret.

## First real-money test plan

Use your own phone and a real MTN number, and the smallest fare you can. After each step, confirm with the checks below.

1. **Pay.** Request a ride, have a rider accept (or approve one), pay with MTN MoMo. Your phone should show MTN's PIN
   prompt. Approve it. The order should move to funded.
2. **Decline.** Repeat, and this time cancel or ignore the prompt. The payment should end `failed`, the customer should see
   a clear message, and no rider should be left stuck (a rider on an unpaid order is released automatically after the
   admin-set wait, 15 minutes by default).
3. **Pay out.** Finish a ride so the rider's wallet is credited, then withdraw to a real MTN number. It should end
   `successful`, and the money should arrive.
4. **Anything that goes wrong:** open the Cloudflare logs (Workers & Pages → `peebee-api` → Logs) and search for
   `MTN MoMo`. Failed calls write MTN's reply there, with phone numbers masked, and the customer sees a reviewed message
   instead of a generic error.

Useful checks in the database console:

```sql
-- the newest customer payments and their result
SELECT id, order_id, provider, status, amount, currency, created_at FROM payments ORDER BY created_at DESC LIMIT 5;
-- the newest payouts
SELECT id, amount, provider, status, environment, created_at FROM wallet_withdrawals ORDER BY created_at DESC LIMIT 5;
```

## Unknown: ask MTN, do not assume

I could not see MTN's production onboarding, so these are open. Each one is an answer you need from MTN or from the
Go-Live page on the MTN developer site before step 1:

- **What MTN asks for at Go-Live:** business and KYC documents, proof of testing, a signed agreement, review time.
- **How production keys are issued:** through the developer portal, a provisioning call, or by MTN directly. They are
  not the same as the sandbox keys; the API users you created in the sandbox will not work in production.
- **The exact production base URL and the exact Environment (target environment) text for your country.**
- **Whether Collections and Disbursements are approved together or one after the other.** Peebee assumes separately and
  will not call MTN "configured" until both keys are in.
- **Limits, fees and settlement:** per-transaction and daily limits, MTN's charges, and which account Collections money
  settles to.
- **Any callback, IP allow-list or domain requirement.** Peebee does not send a callback URL today. If MTN requires one,
  that is a code change.
- **A fixed IP address for Disbursements.** MTN asks for production Disbursements calls to come from IP addresses it has
  allow-listed. The API runs on Cloudflare Workers, which have no fixed outgoing IP, so as it stands MTN cannot
  allow-list it. The usual fix is a small forwarder on a static IP that only the MTN calls go through; `MOMO_BASE_URL`
  can point at it. Settle this with MTN before relying on MTN for payouts. Until then, use another payout provider
  (Yo! or Airtel) for riders and customers.
- **Refunds.** Peebee refunds a cancelled order to the customer's Peebee wallet, not back to their MoMo. That is
  deliberate (a refund never starts a second MoMo transaction), but confirm it is acceptable to MTN and your customers.

## Behaviour added since this page was first written

- **A payment that is never confirmed times out.** Admin → Payments → "Minutes before a pending payment fails" (default
  10, 0 = wait forever). The payment is marked failed so the customer can try again, and a rider attached to the order
  goes back to the unpaid wait described above. Payouts never time out.
- **A late approval is not lost.** For "Hours to keep watching for a late approval" (default 24) Peebee keeps asking MTN
  about a timed-out payment. If the customer approved after all, the amount is added to their Peebee wallet, once, and
  they are told. Recent failed payments on the Admin dashboard mark these.
- **Test keys are flagged.** The MTN card shows "Test keys" while its Environment is blank or `sandbox`, and a banner
  warns when that is the case on a Live platform. Any other Environment value counts as production.
- **Verified withdrawal numbers.** Admin → Payments → "Require a verified number to withdraw" (off by default) makes
  rider, car-driver and customer cash-outs go only to a saved number the owner proved with a texted code. It needs
  migration 0155 and the SMS provider. Turn it on before launch if MTN's consent guidance applies to payouts.
- **A rider can leave an order that is still waiting for payment.**

## Known gaps worth deciding before launch

- **Peebee Car rides, relayed parcels and combined deliveries** are not released automatically if the customer never pays
  (ordinary rides and deliveries are). A person has to cancel those.
- **A pending payout only completes while the rider's Wallet screen is open**; there is no background check for
  withdrawals. If you expect many payouts, this is worth adding before launch.
