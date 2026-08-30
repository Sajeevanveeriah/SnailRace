import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkoutCommandFor } from '../lib/checkout-command';

test('an unchanged checkout retry reuses the same command ID', () => {
  let generated = 0;
  const createId = () => `command-${++generated}-abcdefgh`;
  const first = checkoutCommandFor(null, 'event:race:lane:amount', createId);
  const retry = checkoutCommandFor(first, 'event:race:lane:amount', createId);

  assert.strictEqual(retry, first);
  assert.equal(retry.commandId, 'command-1-abcdefgh');
  assert.equal(generated, 1);
});

test('changed donation details rotate the checkout command ID', () => {
  let generated = 0;
  const createId = () => `command-${++generated}-abcdefgh`;
  const first = checkoutCommandFor(null, 'event:race:lane:1000', createId);
  const changed = checkoutCommandFor(first, 'event:race:lane:2000', createId);

  assert.notEqual(changed.commandId, first.commandId);
  assert.equal(changed.commandId, 'command-2-abcdefgh');
  assert.equal(generated, 2);
});
