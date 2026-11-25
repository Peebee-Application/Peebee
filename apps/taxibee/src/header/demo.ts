import { createApiClient } from "../../../../packages/shared/src/api-client";
import type { AuthUser } from "../../../../packages/shared/src/domain";

export function createHeaderDemo(walletBalance: number) {
  let user = {
    id: "taxibee-demo",
    name: "Demo Traveller",
    phone: "",
    role: "customer",
    passwordSet: true,
  } as AuthUser;
  const api = createApiClient({
    baseUrl: location.origin + "/api",
    getToken: () => null,
    fetchImpl: async (input, init) => {
      const path = new URL(String(input), location.origin).pathname;
      const method = init?.method || "GET";
      if (path === "/api/v1/users/me/profile" && method === "PATCH") {
        const { name } = JSON.parse(String(init?.body));
        user = { ...user, name };
        return Response.json({ name });
      }
      if (method === "GET") {
        if (path === "/api/v1/settings") return Response.json({ settings: {} });
        if (path === "/api/v1/auth/me") return Response.json({ user });
        if (path === "/api/v1/wallet") return Response.json({ balance: walletBalance, ledger: [] });
        if (path === "/api/v1/locations") return Response.json({ locations: [] });
        if (path === "/api/v1/wallet/alerts") return Response.json({ alerts: [] });
        if (path === "/api/v1/chat/threads" || path === "/api/v1/restaurants/chats/mine" || path.includes("/school")) {
          return Response.json({ threads: [] });
        }
      }
      // The preview never falls back to the live network.
      return Response.json({ message: "This action is available in live Taxibee." }, { status: 404 });
    },
  });
  return { api, user: () => user };
}
