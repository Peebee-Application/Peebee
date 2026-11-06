import { adminRequest } from "./admin-request";

/** What Admin can do to a person; not every kind supports every action. */
export type PersonAction = "approve" | "reject" | "suspend" | "reinstate";

export type ReviewKind =
  | "user" | "rider" | "car_owner" | "car_driver" | "taxipress" | "relay" | "restaurant" | "merchant"
  | "work_provider" | "worker" | "service_business" | "channel" | "school" | "platform";

/** Kinds that can be rejected as well as approved. The rest go from waiting to active, or to suspended. */
const CAN_REJECT: ReviewKind[] = ["car_owner", "car_driver", "merchant", "work_provider", "worker"];

export const canReject = (kind: ReviewKind) => CAN_REJECT.includes(kind);

/** Channels will not suspend without a stated reason. */
export const needsReason = (kind: ReviewKind, action: PersonAction) => kind === "channel" && action === "suspend";

const enc = encodeURIComponent;
const post = (path: string, body: unknown) => adminRequest(path, { method: "POST", body });
const accountStatus = (userId: string, active: boolean) => post(`/admin/users/${enc(userId)}/status`, { status: active ? "active" : "suspended" });

/**
 * Does the change by calling that kind's own admin endpoint, so its rules, notices and activity log all apply.
 * Only fuel stations, station staff and Hire employers go through the new /admin/platform endpoint.
 */
export async function performAction(kind: ReviewKind, key: string, item: { id: string; userId: string | null }, action: PersonAction, reason?: string): Promise<void> {
  const id = enc(item.id);
  const on = action === "approve" || action === "reinstate";
  switch (kind) {
    case "user":
      await accountStatus(item.userId ?? item.id, on);
      return;
    case "rider":
      if (action === "approve") await post(`/admin/riders/${id}/verify`, { verified: true });
      else await accountStatus(item.userId ?? item.id, on);
      return;
    case "car_owner":
    case "car_driver":
      await post(`/admin/car/partners/${id}/decision`, { role: kind === "car_owner" ? "owner" : "driver", status: on ? "approved" : action === "reject" ? "rejected" : "suspended" });
      return;
    case "taxipress":
      await post(`/admin/taxipress/taxis/${id}`, { status: on ? "approved" : "suspended" });
      return;
    case "relay":
      await post(`/admin/relay/operators/${id}/status`, { status: on ? "approved" : "suspended" });
      return;
    case "restaurant":
      await post(`/admin/restaurants/${id}/status`, { status: on ? "active" : "suspended" });
      return;
    case "merchant":
      await post(`/admin/merchants/${id}/status`, { status: on ? "active" : action === "reject" ? "rejected" : "suspended" });
      return;
    case "work_provider":
      await post(`/work/admin/providers/${id}/${action}`, { note: reason });
      return;
    case "worker":
      await post(`/talent/admin/workers/${id}/${action}`, { note: reason });
      return;
    case "service_business":
      await post(`/services-platform/admin/businesses/${id}/review`, { decision: action === "suspend" ? "pause" : action === "reinstate" ? "reactivate" : "approve", note: reason });
      return;
    case "channel":
      await post(`/admin/channels/${id}/status`, { status: on ? "active" : "suspended", reason });
      return;
    case "school":
      await post(`/admin/learn-schools/${id}/status`, { status: on ? "active" : "suspended" });
      return;
    case "platform":
      await post(`/admin/platform/people/${enc(key)}/${id}/status`, { status: on ? "active" : "suspended" });
      return;
  }
}
