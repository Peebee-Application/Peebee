"use client";

import { HelpSupport } from "@peebee/shared/help-support";
import { AccountFrame, useBack } from "../../components/account/AccountUI";
import { PageHeader } from "../../components/store/StoreUI";
import { getStoredToken } from "../../lib/api";

export default function HelpPage() {
  const back = useBack("/account");
  return (
    <AccountFrame testId="help-page">
      <PageHeader title="Help & support" onBack={back} backLabel="Back" />
      <HelpSupport app="merchant" variant="merchant" apiBase={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:10000"} getToken={getStoredToken} />
    </AccountFrame>
  );
}
