# Admin API key rotation

Settings → Email API keys manages Resend. Settings → Google AI keys manages
Gemini. Each provider has an independent live/testing mode. These settings do
not change the platform's live/sandbox dataset or the provider's billing plan.
Testing mode makes real provider requests and sends real emails.

## Resend setup

1. Apply `apps/api/src/db/migrations/0076_email_api_keys.sql` to the API database
   by hand. Deployment does not apply migrations. Until both new tables exist,
   email delivery keeps using `RESEND_API_KEY` and `RESEND_FROM`.
2. Set `CREDENTIALS_ENCRYPTION_KEY` on the API before adding keys. Preserve this
   secret: changing it makes stored credentials unreadable. The admin API
   rejects credential writes while it is missing.
3. Add named Resend keys with their verified sender and account/team name.
   Give every key from the same Resend team the same account name (names are
   normalized to lowercase). Sender/key permissions are checked on delivery;
   adding a key does not send an email or verify the credential with Resend.
4. Choose one enabled key with **Use for live**. It leaves the testing pool.
   Live mode uses only this key. Until a live key is chosen, live mode may
   keep using the server's existing Resend secret. A disabled or exhausted
   selected live key fails delivery; it does not fall back to testing keys.
5. Choose Testing, set the timer and request budget, then Save mode and
   rotation. Testing requires at least one enabled non-live key and never
   falls back to the server secret or the selected live key.

Rotation advances in UTC clock slots shared by all API Worker instances. With
a 300-second interval, a switch occurs at each five-minute UTC boundary. The
next request uses the scheduled key; no background job or traffic is required
to advance the schedule. Disabling/removing/adding keys changes the pool and
can change its scheduled key. Status is a snapshot; Refresh status updates it.

The optional budget counts outbound attempts per **account**, including failed
attempts. Reservation is atomic across concurrent requests. Zero requests
means no app-level budget. Windows align to the configured interval from the
Unix epoch; 86,400 seconds is a UTC calendar day. Live attempts contribute to
the counter but are not blocked by the testing budget. Editing the budget
window changes its boundaries. These counters exclude traffic outside this
app, so they do not represent the full provider allowance.

Provider 429 responses pause the whole account group, including live and
testing siblings. Daily quotas resume at midnight UTC. Other limits honor
Retry-After; monthly or unknown limits without a retry time use the admin's
configured retry interval because billing reset dates differ by account.
During testing a rejected request may use another eligible account group;
keys in the paused group cannot bypass its quota. Invalid credentials are
disabled. Network errors, validation errors and server failures are not
replayed against another key. Each email request carries an idempotency key,
and bookkeeping failure cannot trigger a second outbound send.

Stored keys are encrypted with AES-GCM. Responses show only a four-character
hint. Settings changes, additions, activation, disable and deletion are
recorded in the admin activity log without raw credentials. Access requires
`settings.manage`. A live key cannot be removed or manually disabled while
live mode is active.

## Google AI

The existing master key is labeled Live in the admin screen (`paid` is retained
in the API/database for compatibility). The master never joins testing
rotation. Set a positive rotation interval in seconds for clock slots, or 0
to preserve the previous per-request rotation. An exhausted key is skipped
immediately without waiting for the timer. Google quotas remain per project
and model; matching project tags share cooldowns. Keys and limits require
the existing migrations 0074 and 0075; the timer itself uses the settings
table and adds no Google schema requirement.

## Verification

Provider integration tests use a real local SQLite database and mocked
provider responses. They cover permission gates, encryption, masked
responses, duplicate detection, pre-migration compatibility, timed slots,
live isolation, shared quota cooldowns, concurrent budgets, window reset,
non-replayed network failures and OTP delivery failing safely when every key
is disabled. They do not send email or spend generation quota.

Provider references:
- [Resend usage limits](https://resend.com/docs/api-reference/rate-limit)
- [Google AI rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
