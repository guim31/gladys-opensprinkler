// -----------------------------------------------------------------------------
// The API client against the fake controller (answers of firmware 2.2.1(6)):
// the password hash, the error kinds, the fallback of old firmwares without
// /ja, one request at a time, and never the password in an error message.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, OpenSprinklerClient, md5 } from '../src/opensprinkler/client.js';
import { DEFAULT_PASSWORD, FakeOpenSprinkler } from './helpers/fakeOpenSprinkler.js';

const URL_1 = 'http://192.0.2.10';

function client(controller, password = DEFAULT_PASSWORD) {
  return new OpenSprinklerClient({
    url: URL_1,
    password,
    request: (url) => controller.handle(url),
  });
}

test('the password travels as its lowercase MD5 hash', async () => {
  // The hash of "opendoor" used by the firmware's own API tests.
  assert.equal(md5('opendoor'), 'a6d82bced638de3def1e9bbb4983225c');
  const controller = new FakeOpenSprinkler();
  const seen = [];
  const c = new OpenSprinklerClient({
    url: `${URL_1}/`,
    password: DEFAULT_PASSWORD,
    request: (url) => {
      seen.push(url);
      return controller.handle(url);
    },
  });
  const all = await c.readAll();
  assert.ok(all.settings && all.options && all.stations && all.status && all.programs);
  assert.equal(seen.length, 1, 'one /ja request');
  assert.equal(seen[0], `${URL_1}/ja?pw=a6d82bced638de3def1e9bbb4983225c`);
});

test('a wrong password is an auth error, on /ja and on /jo', async () => {
  const controller = new FakeOpenSprinkler();
  const c = client(controller, 'wrong');
  await assert.rejects(c.readAll(), (err) => err.kind === ERROR_KINDS.AUTH);
  // /jo answers {"fwv":221} to a wrong password.
  await assert.rejects(c.call('/jo'), (err) => err.kind === ERROR_KINDS.AUTH);
});

test('an old firmware without /ja is read endpoint by endpoint, then never asked /ja again', async () => {
  const controller = new FakeOpenSprinkler({ legacy: true });
  const c = client(controller);
  const all = await c.readAll();
  assert.equal(all.options.fwv, 221);
  assert.deepEqual(
    controller.requests.map((r) => r.path),
    ['/ja', '/jc', '/jo', '/jn', '/js', '/jp'],
  );
  controller.requests.length = 0;
  await c.readAll();
  assert.deepEqual(
    controller.requests.map((r) => r.path),
    ['/jc', '/jo', '/jn', '/js', '/jp'],
  );
});

test('an older firmware answering {"result":32} to /ja falls back too', async () => {
  const controller = new FakeOpenSprinkler();
  const original = controller.handle.bind(controller);
  controller.handle = async (url) =>
    new URL(url).pathname === '/ja' ? { status: 200, body: '{"result":32}' } : original(url);
  const all = await client(controller).readAll();
  assert.equal(all.programs.nprogs, 2);
});

test('a controller that does not answer, an answer that is not the API', async () => {
  const controller = new FakeOpenSprinkler();
  controller.online = false;
  await assert.rejects(client(controller).readAll(), (err) => err.kind === ERROR_KINDS.UNREACHABLE);

  const html = new OpenSprinklerClient({
    url: URL_1,
    password: 'x',
    request: async () => ({ status: 200, body: '<html>router</html>' }),
  });
  await assert.rejects(html.call('/jc'), (err) => err.kind === ERROR_KINDS.NOT_OPENSPRINKLER);

  const busy = new OpenSprinklerClient({
    url: URL_1,
    password: 'x',
    request: async () => ({ status: 503, body: '' }),
  });
  await assert.rejects(busy.call('/jc'), (err) => err.kind === ERROR_KINDS.UNREACHABLE);
});

test('commands: the parameters the firmware expects, refusals with their code', async () => {
  const controller = new FakeOpenSprinkler();
  const c = client(controller);
  await c.runStation(2, 600);
  await assert.rejects(c.runStation(2, 600), (err) => {
    assert.equal(err.kind, ERROR_KINDS.REFUSED);
    assert.equal(err.code, 48);
    return true;
  });
  await c.stopStation(2);
  await c.stopAll();
  await c.runProgram(0, true);
  await c.setProgramEnabled(1, true);
  await c.setEnabled(false);
  await c.setRainDelay(24);
  // Out of the documented range: clamped before sending.
  await c.runStation(4, 999_999);
  await c.setRainDelay(-3);
  assert.deepEqual(
    controller.requests.map(({ path, params }) => [path, params]),
    [
      ['/cm', { sid: '2', en: '1', t: '600' }],
      ['/cm', { sid: '2', en: '1', t: '600' }],
      ['/cm', { sid: '2', en: '0' }],
      ['/cv', { rsn: '1' }],
      ['/mp', { pid: '0', uwt: '1' }],
      ['/cp', { pid: '1', en: '1' }],
      ['/cv', { en: '0' }],
      ['/cv', { rd: '24' }],
      ['/cm', { sid: '4', en: '1', t: '64800' }],
      ['/cv', { rd: '0' }],
    ],
  );
});

test('requests are sent one at a time', async () => {
  const controller = new FakeOpenSprinkler();
  let inFlight = 0;
  let most = 0;
  const c = new OpenSprinklerClient({
    url: URL_1,
    password: DEFAULT_PASSWORD,
    request: async (url) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return controller.handle(url);
    },
  });
  await Promise.all([c.call('/jc'), c.call('/jo'), c.runStation(0, 60), c.call('/js')]);
  assert.equal(most, 1);
});

test('error messages name the endpoint, never the password or its hash', async () => {
  const secret = 'my-very-secret';
  const controller = new FakeOpenSprinkler({ password: 'other' });
  const c = client(controller, secret);
  const errors = [];
  for (const run of [() => c.readAll(), () => c.call('/jo'), () => c.runStation(0, 60)]) {
    await run().catch((err) => errors.push(err.message));
  }
  controller.online = false;
  await c.readAll().catch((err) => errors.push(err.message));
  assert.equal(errors.length, 4);
  for (const message of errors) {
    assert.ok(!message.includes(secret), message);
    assert.ok(!message.includes(md5(secret)), message);
    assert.ok(!message.includes('pw='), message);
  }
});
