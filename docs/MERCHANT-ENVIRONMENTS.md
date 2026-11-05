# Merchant environments

Normal merchant sessions follow the Admin platform environment. Practice-session
tokens force sandbox for their own requests without changing the global setting.
Both new and existing businesses follow this rule; a business registered while the
platform was in sandbox is usable when the platform is live.

The persisted `merchants.environment` records the environment at registration. It
must not select the current dashboard, balance, payment or withdrawal environment.
Merchant API responses project the active environment, while Admin may explicitly
inspect live or sandbox balances and history with its environment query parameter.

Financial records retain their original environment. Switching environments does
not convert or copy balances, ledger entries, receipts, quotes or settlements.
The first confirmed receipt in a new environment creates its balance row inside
the same atomic ledger batch. An unused balance reads as zero.

Withdrawal quotes can only be submitted in the environment in which they were
issued. The verified destination and its cooling period are checked again at
submission. Admin controls the live cooling period through the
`merchant_settlement_cooling_hours` option under Commerce options → Limits & team
roles; changing it also requires `payments.manage`. Live merchant payment
activation and custody approval remain separately required.

No database migration or bulk update of existing merchant or financial records is
required for this correction.
