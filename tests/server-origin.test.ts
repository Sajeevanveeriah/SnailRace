import assert from 'node:assert/strict';
import test from 'node:test';
import { checkOrigin } from '../lib/server-origin';

const request = (url: string, origin?: string) =>
  new Request(url, { headers: origin ? { Origin: origin } : undefined });

test('an exact request origin is accepted', () => {
  assert.deepEqual(checkOrigin(request('http://127.0.0.1:3000/api/live/session', 'http://127.0.0.1:3000')), {
    origin: 'http://127.0.0.1:3000',
    ok: true,
  });
});

test('Next loopback normalisation does not reject the same local server', () => {
  assert.deepEqual(checkOrigin(request('http://localhost:3000/api/live/session', 'http://127.0.0.1:3000')), {
    origin: 'http://127.0.0.1:3000',
    ok: true,
  });
  assert.equal(
    checkOrigin(request('http://127.0.0.1:3000/api/live/session', 'http://localhost:3000')).ok,
    true,
  );
});

test('loopback equivalence still requires the same scheme and port', () => {
  assert.equal(
    checkOrigin(request('http://localhost:3000/api/live/session', 'http://127.0.0.1:3001')).ok,
    false,
  );
  assert.equal(
    checkOrigin(request('https://localhost:3000/api/live/session', 'http://127.0.0.1:3000')).ok,
    false,
  );
});

test('foreign origins and missing origins remain rejected', () => {
  assert.equal(checkOrigin(request('https://club.example/api/live/session', 'https://attacker.example')).ok, false);
  assert.equal(checkOrigin(request('https://club.example/api/live/session')).ok, false);
});
