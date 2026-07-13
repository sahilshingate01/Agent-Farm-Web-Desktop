function hasCapabilities(route, required) {
  const available = new Set(Array.isArray(route.capabilities) ? route.capabilities : []);
  return required.every((capability) => available.has(capability));
}

function isAvailable(route) {
  if (!['online', 'busy', 'paused'].includes(route.status)) return false;
  if (!['running', 'paused'].includes(route.lifecycle)) return false;
  const capacity = Number.isFinite(route.maxConcurrency) ? route.maxConcurrency : 1;
  const active = Number.isFinite(route.active) ? route.active : 0;
  return capacity > 0 && active < capacity;
}

function compareRoutes(left, right) {
  const priority = (right.priority ?? 0) - (left.priority ?? 0);
  if (priority) return priority;

  const lifecycleRank = { running: 2, paused: 1 };
  const lifecycle = (lifecycleRank[right.lifecycle] ?? 0) - (lifecycleRank[left.lifecycle] ?? 0);
  if (lifecycle) return lifecycle;

  const localityRank = { local: 3, remote: 2, cloud: 1 };
  const locality = (localityRank[right.locality] ?? 0) - (localityRank[left.locality] ?? 0);
  if (locality) return locality;

  const leftLoad = (left.active ?? 0) / Math.max(left.maxConcurrency ?? 1, 1);
  const rightLoad = (right.active ?? 0) / Math.max(right.maxConcurrency ?? 1, 1);
  if (leftLoad !== rightLoad) return leftLoad - rightLoad;

  const latency = (left.latencyMs ?? Number.POSITIVE_INFINITY) - (right.latencyMs ?? Number.POSITIVE_INFINITY);
  if (latency) return latency;
  return String(left.id).localeCompare(String(right.id));
}

export function pickCrewRoute(routes, request = {}) {
  const required = Array.isArray(request.capabilities) ? request.capabilities : [];
  return (routes ?? [])
    .filter((route) => route?.id && isAvailable(route) && hasCapabilities(route, required))
    .sort(compareRoutes)[0] ?? null;
}
