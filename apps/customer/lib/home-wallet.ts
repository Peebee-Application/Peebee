import type { CustomerWallet, CustomerWalletSummary, WalletShares } from "@peebee/shared";

export type HomeWalletAccount = {
  id: string; name: string; balance: number | null; frozen: boolean;
  verified: boolean; shared: boolean; owner?: string; detailsHref: string; fundHref: string | null;
};

/** Use real named accounts; pending invitations never expose a balance. */
export function homeWalletAccounts(wallet: CustomerWallet, accounts: CustomerWalletSummary[], shares: WalletShares | null): HomeWalletAccount[] {
  const own = accounts.length ? accounts : [{ id: "primary", name: "Personal", balance: wallet.balance, isPrimary: true, frozen: wallet.frozen }];
  return [
    ...own.map((account): HomeWalletAccount => {
      const query = `tab=accounts&account=${encodeURIComponent(account.id)}`;
      return {
        id: `own:${account.id}`, name: account.isPrimary && /^(main wallet|primary|main|main account)$/i.test(account.name.trim()) ? "Personal" : account.name,
        balance: account.balance, frozen: !!account.frozen, verified: wallet.verified, shared: false,
        detailsHref: `/wallet?${query}`,
        // External top-ups fund the primary account. Other accounts use Wallet's existing Move flow.
        fundHref: account.frozen ? null : account.isPrimary ? "/wallet?tab=topup" : `/wallet?${query}&action=move`,
      };
    }),
    ...(shares?.received ?? []).filter(share => share.status === "active").map((share): HomeWalletAccount => ({
      id: `shared:${share.id}`, name: share.wallet_name || share.owner_name,
      balance: share.owner_balance, frozen: false, verified: false, shared: true, owner: share.owner_name,
      detailsHref: "/wallet?tab=accounts", fundHref: null,
    })),
  ];
}

export function walletDeckIndex(current: number, direction: number, count: number): number {
  return count > 0 ? ((current + direction) % count + count) % count : 0;
}
