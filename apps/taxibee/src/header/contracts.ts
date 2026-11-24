import type { createApiClient } from "../../../../packages/shared/src/api-client";
import type { AuthUser } from "../../../../packages/shared/src/domain";

export interface TaxibeeHeaderHost {
  api: ReturnType<typeof createApiClient>;
  getUser: () => AuthUser | null;
  getToken: () => string | null;
  updateUser: (user: AuthUser) => void;
  setSession: (token: string, user: AuthUser) => void;
  signOut: () => void;
  signIn: () => void;
  openLocal: (screen: string, action?: string) => void;
  subscribePush: () => Promise<boolean>;
}

export interface TaxibeeHeader {
  mount: (root: HTMLElement, host: TaxibeeHeaderHost) => void;
  sync: () => void;
}
