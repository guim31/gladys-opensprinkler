// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never a password, its MD5 hash, or a URL carrying
// it. (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md5 } from '../src/opensprinkler/client.js';
import {
  DEFAULT_PASSWORD,
  FakeOpenSprinkler,
  URL_1,
  createAll,
  createClock,
  createWorld,
  deviceId,
} from './helpers/world.js';

const SECRET = 'Sprinkler-Secret-42';

/** Capture the lines of the SDK logger at the given LOG_LEVEL. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, { password = SECRET, controllerPassword = SECRET } = {}) {
  const clock = createClock();
  const controller = new FakeOpenSprinkler({ password: controllerPassword });
  const w = await createWorld({
    clock,
    controllers: { [URL_1]: controller },
    config: { controller_1_url: URL_1, controller_1_password: password, language: 'en' },
  });
  t.after(() => w.app.stop());
  return { ...w, controller };
}

function assertNoSecret(text) {
  assert.ok(!text.includes(SECRET), 'never the password');
  assert.ok(!text.includes(md5(SECRET)), 'never its MD5 hash');
  assert.ok(!text.includes('pw='), 'never a URL with the password');
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('connected')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();

  for (let i = 0; i < 5; i += 1) {
    w.controller.options.wl = 70 + i;
    w.controller.advance(30);
    w.clock.advance(30_000);
    await w.hub.pollAll({ force: true });
  }
  assert.deepEqual(logs.texts(), []);
});

test('a user command is one info line', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  await w.fake.sceneAction('run_station', { device: deviceId(w.gladys), station: 1, minutes: 5 });
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /\[INFO\].*station 1 started for 5 min/);
});

test('a controller that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();

  w.controller.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.pollAll({ force: true });
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');

  logs.clear();
  w.controller.online = true;
  await w.hub.pollAll({ force: true });
  await w.hub.pollAll({ force: true });
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /answers again after 5 min/);
});

test('a refused password is logged once, without the password', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { controllerPassword: 'another' });
  for (let i = 0; i < 5; i += 1) {
    await w.hub.pollAll({ force: true });
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(warnings[0].text, /password refused/);
  assertNoSecret(logs.texts().join('\n'));
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.gladys.publishStates = async () => {
    throw new Error('HTTP 500');
  };
  for (let i = 0; i < 4; i += 1) {
    w.controller.options.wl = 50 + i;
    await w.hub.pollAll({ force: true });
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States of .* refused/);
});

test('LOG_LEVEL=debug shows each reading problem, still no secret anywhere', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await createAll(w);
  await w.fake.sceneAction('run_station', { device: deviceId(w.gladys), station: 2, minutes: 5 });
  await w.fake.sceneAction('run_station', { device: deviceId(w.gladys), station: 2, minutes: 5 });
  w.controller.online = false;
  await w.hub.pollAll({ force: true });
  await w.hub.pollAll({ force: true });
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*again/);
  assertNoSecret(text);
  // Nor the factory default, when the user kept it.
  const factory = captureLogs(t, 'debug');
  const w2 = await world(t, { password: DEFAULT_PASSWORD, controllerPassword: DEFAULT_PASSWORD });
  await w2.hub.pollAll({ force: true });
  assert.ok(!factory.texts().join('\n').includes(md5(DEFAULT_PASSWORD)));
});
