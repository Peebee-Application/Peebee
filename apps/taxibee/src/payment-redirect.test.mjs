import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutUrl } from './payment-redirect.mjs';
test('checkout addresses reject script/data schemes, insecure remote URLs and URL credentials', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'http://checkout.example/pay', 'https://user:pass@checkout.example/pay', 'file:///tmp/test']) {
    assert.throws(() => checkoutUrl(value, 'https://taxibee.peebee.online/'));
  }
  assert.equal(checkoutUrl('https://checkout.example/pay?ref=123', 'https://taxibee.peebee.online/'), 'https://checkout.example/pay?ref=123');
  assert.equal(checkoutUrl('/ticket', 'http://localhost:3015/'), 'http://localhost:3015/ticket');
});
