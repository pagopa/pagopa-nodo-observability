/**
 * MSAL v5 silent renewal loads the redirect URI in a hidden iframe and waits for the response on a
 * BroadcastChannel: that page must hand the response back with `broadcastResponseToMainFrame()`
 * instead of starting the application, otherwise the renewal always times out.
 */
export function isSilentAuthCallback(win: Pick<Window, 'parent' | 'location'>): boolean {
  if (win.parent === win) return false;
  const params = new URLSearchParams(win.location.hash.replace(/^#/, ''));
  return params.has('state') && (params.has('code') || params.has('error'));
}

export async function completeSilentAuthCallback(): Promise<void> {
  const { broadcastResponseToMainFrame } = await import('@azure/msal-browser/redirect-bridge');
  await broadcastResponseToMainFrame();
}
