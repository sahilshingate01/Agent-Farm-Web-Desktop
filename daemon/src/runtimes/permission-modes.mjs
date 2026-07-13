// The four farm permission principles → claude permission modes. The desktop
// and gateway speak read-only/ask/auto/full (spec C, 2026-07-15); the managed
// runtimes previously forwarded raw claude strings only. Unknown values pass
// through untouched for back-compat with existing silo descriptors.
const PRINCIPLE_TO_CLAUDE = {
  'read-only': 'plan',
  ask: 'default',
  auto: 'acceptEdits',
  full: 'bypassPermissions',
};

export function claudePermissionMode(value) {
  const key = String(value || '').trim();
  return PRINCIPLE_TO_CLAUDE[key] || key;
}
