# Peebee Merchant sandbox test run

The sandbox reproduces the production workflow without moving real money. It uses separate orders, balances, ledger entries, merchant payables, and provider operations. Every sandbox collection and settlement is forced through the simulator even when live provider credentials are saved.

## Prepare the environment

1. In Admin, open **Settings → Platform** and select **Sandbox**.
2. Open **Settings → Merchant payments**. Confirm that **Merchant allocation flow** is enabled. Sandbox is enabled by default after the merchant-finance migration.
3. Create all test orders after switching to Sandbox. Existing orders retain the funds model and environment with which they were created.

## Onboard and approve a merchant

1. Sign into Peebee Merchant with a customer account and submit a formal-business application.
2. Upload the owner identity and business-registration documents, then submit the registration number, tax ID, and declaration.
3. In Admin **Settings → Merchant payments**, review the application and documents, then choose **Approve and activate**.
4. Confirm that the merchant app shows the blue **Sandbox** badge and **Safe test mode** notice.

KYC and administrator approval remain mandatory in sandbox so the test exercises the same responsibilities and permissions as live operation.

## Test a purchase

1. As a customer, create and fund a new shopping order.
2. Complete rider matching and have the rider enter or scan the active merchant outlet code.
3. The rider enters the exact purchase amount and confirms it. Location, remaining budget, duplicate-reference, related-party, and order-state checks still run.
4. In Peebee Merchant, open **Payments**, look up the payment code if necessary, verify the amount, and confirm goods handover.
5. Verify that the merchant available balance increases, the customer sees the purchase, and the order spending balance decreases by exactly the same amount.

## Test settlement

1. In the merchant wallet, add an MTN or Airtel Mobile Money destination using a valid-looking Ugandan number.
2. In Admin **Settings → Merchant payments**, choose **Verify for sandbox** for that destination.
3. Sandbox skips the live 24-hour destination cooldown after verification, allowing the test to continue immediately.
4. Request a scheduled or instant settlement and confirm the quote.
5. The settlement initially appears pending. The app polls its status and normally reaches a final simulated state after about six seconds.

The simulator intentionally produces a small number of failed transactions. A failed settlement must restore the full reserved balance exactly once; a successful settlement must reduce the payable and record the provider operation and fee.

## Safety guarantees

- Sandbox never calls a real collection or disbursement provider.
- Sandbox and live merchant activation switches are independent.
- Switching to Live does not enable merchant payments without a current regulated-custody approval.
- Sandbox balances cannot be withdrawn through live rails or merged into live balances.
- Pending or unknown payouts are polled; they are never blindly resent.
