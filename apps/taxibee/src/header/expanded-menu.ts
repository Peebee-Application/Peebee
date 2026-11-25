import { useMemo } from "react";
import { useHeaderDrawer as useCustomerDrawer } from "../../../customer/lib/header-drawer";

export { shouldAutoOpenDrawerSection } from "../../../customer/lib/header-drawer";

// Taxibee's header arrow opens the selected full section in one step.
export function useHeaderDrawer() {
  const drawer = useCustomerDrawer();
  return useMemo(() => ({
    ...drawer,
    openMenu: () => drawer.openSection(drawer.section),
  }), [drawer]);
}
