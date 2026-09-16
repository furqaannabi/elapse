/**
 * Leaving the hosted checkout for the merchant's own site: a full navigation, not a client route.
 * Kept in one function so the page's automatic return (FR-CHK-033) can be tested without a browser.
 */
export function leaveTo(url: string): void {
  window.location.assign(url);
}

/** `success_url?session_id=cs_…`, the address every "Back to {merchant}" uses (FR-CHK-009). */
export function successHrefOf(session: { id: string; merchant: { successUrl: string } }): string {
  const url = session.merchant.successUrl;
  return `${url}${url.includes("?") ? "&" : "?"}session_id=${session.id}`;
}
