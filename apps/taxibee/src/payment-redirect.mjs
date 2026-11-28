// A provider response is data, not permission to execute a URL as script.
export function checkoutUrl(value, base) {
  const url = new URL(value, base);
  if ((url.protocol !== 'https:' && url.origin !== new URL(base).origin) ||
      !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('The payment provider returned an unsafe checkout address.');
  }
  return url.href;
}
export function redirectToCheckout(value) {
  location.assign(checkoutUrl(value, location.href));
}
