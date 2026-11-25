import { useLocationLabel as useCustomerLocation } from "../../../customer/lib/use-location-label";
import { isPracticeMode } from "./practice";

export function useLocationLabel(enabled: boolean) {
  const demo = isPracticeMode();
  const location = useCustomerLocation(enabled && !demo);
  return demo ? { label: "Kampala", status: "done" as const } : location;
}
