// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys does not poll external devices
// reliably (GladysAssistant/Gladys#3198: a device created without
// should_poll is never polled, even once the core is fixed): the controllers
// must be read by the hub's own timer, with no onPoll at all. onPoll stays
// as a fallback that skips a controller the timer just read.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PASSWORD,
  FakeOpenSprinkler,
  URL_1,
  createAll,
  createClock,
  createWorld,
  featureId,
  variant,
} from './helpers/world.js';

/** Let the timer callback and the fake network settle. */
const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const config = {
  controller_1_url: URL_1,
  controller_1_password: DEFAULT_PASSWORD,
  poll_interval: '30',
};

test('the internal timer refreshes the states without any onPoll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const controller = new FakeOpenSprinkler();
  const w = await createWorld({
    clock,
    controllers: { [URL_1]: controller },
    config,
    timers: true,
  });
  t.after(() => w.app.stop());
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);

  const device = w.fake.discoveredDevices[0];
  assert.equal(device.should_poll, true);
  assert.equal(device.poll_frequency, 60_000);
  const reads = () => controller.requests.filter((r) => r.path === '/ja').length;
  const before = reads();

  for (const level of [90, 110, 60]) {
    controller.options.wl = level;
    clock.advance(30_000);
    t.mock.timers.tick(30_000);
    await settle();
    assert.equal(w.fake.lastState(featureId(w.gladys, 'water_level')), level);
  }
  assert.equal(reads() - before, 3, 'one reading per interval');
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test("the core's onPoll right after the timer does not read the controller again", async (t) => {
  const clock = createClock();
  const controller = new FakeOpenSprinkler();
  const w = await createWorld({ clock, controllers: { [URL_1]: controller }, config });
  t.after(() => w.app.stop());
  const reads = () => controller.requests.filter((r) => r.path === '/ja').length;
  const before = reads();
  clock.advance(10_000);
  assert.deepEqual(await w.fake.poll(w.fake.discoveredDevices[0]), { success: true });
  assert.equal(reads(), before, 'read 10 s ago: skipped');
  clock.advance(60_000);
  await w.fake.poll(w.fake.discoveredDevices[0]);
  assert.equal(reads(), before + 1, 'the timer stalled: onPoll reads');
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new FakeOpenSprinkler();
  const w = await createWorld({ controllers: { [URL_1]: controller }, config, timers: true });
  await w.app.stop();
  const before = controller.requests.length;
  t.mock.timers.tick(10 * 60_000);
  await settle();
  assert.equal(controller.requests.length, before);
});

test('a station due to start soon is read again right after it starts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // As the firmware answers 1 s after /cm: queued, due to open in 1 s.
  const state = variant('demo-2.2.1/configured-idle.ja.json', (all) => {
    all.settings.ps[3] = [99, 120, all.settings.devt + 1, 0];
  });
  const controller = new FakeOpenSprinkler({ state });
  const w = await createWorld({ controllers: { [URL_1]: controller }, config, timers: true });
  t.after(() => w.app.stop());
  await createAll(w);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'station_3')), 0, 'waiting');

  controller.all.status.sn[3] = 1; // the controller opened it
  t.mock.timers.tick(2_999);
  await settle();
  assert.equal(w.fake.lastState(featureId(w.gladys, 'station_3')), 0, 'not read yet');
  t.mock.timers.tick(1);
  await settle();
  assert.equal(w.fake.lastState(featureId(w.gladys, 'station_3')), 1, 'read 3 s later');
});
