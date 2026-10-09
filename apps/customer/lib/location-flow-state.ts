const listeners = new Set<() => void>();
let activeFlows = 0;

function notify() {
  for (const listener of listeners) listener();
}

export function isLocationFlowOpen() {
  return activeFlows > 0;
}

export function subscribeToLocationFlow(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerLocationFlow() {
  activeFlows += 1;
  notify();
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    activeFlows = Math.max(0, activeFlows - 1);
    notify();
  };
}
