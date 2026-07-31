export type UpdatePolicyInput = {
  isInCall: boolean;
  canSafelyReload: boolean;
  observedDuringCall: boolean;
  updateAfterCallRequested: boolean;
};

export type UpdatePolicy = {
  action: 'reload' | 'update-after-call';
  shouldAutoReload: boolean;
};

/**
 * Keep disruptive update decisions independent from the toast lifecycle.
 * Updates first observed during a call require an explicit defer choice before
 * they can auto-reload when the call ends.
 */
export function selectUpdatePolicy(input: UpdatePolicyInput): UpdatePolicy {
  if (input.isInCall) {
    return { action: 'update-after-call', shouldAutoReload: false };
  }

  return {
    action: 'reload',
    shouldAutoReload:
      input.canSafelyReload && (!input.observedDuringCall || input.updateAfterCallRequested)
  };
}
