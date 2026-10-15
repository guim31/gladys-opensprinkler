// -----------------------------------------------------------------------------
// The hub end to end on the fake Gladys and the fake controller: discovery,
// states, commands of the switches, scene actions and triggers, the water
// meter across restarts, structure changes, connection status.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PASSWORD,
  FakeOpenSprinkler,
  MAC_1,
  URL_1,
  URL_2,
  createAll,
  createWorld,
  deviceId,
  featureId,
  variant,
} from './helpers/world.js';

const IDLE = 'demo-2.2.1/configured-idle.ja.json';

async function world(t, options = {}) {
  const controller = options.controller ?? new FakeOpenSprinkler(options.fake);
  const w = await createWorld({ controllers: { [URL_1]: controller }, ...options.world });
  t.after(() => w.app.stop());
  return { ...w, controller };
}

const featureOf = (w, key) =>
  w.fake.discoveredDevices[0].features.find((f) => f.external_id === featureId(w.gladys, key));

test('one device per controller, identified by its MAC address', async (t) => {
  const w = await world(t);
  const [device] = w.fake.discoveredDevices;
  assert.equal(device.external_id, deviceId(w.gladys));
  assert.equal(device.external_id, `ext:test-integration:controller:${MAC_1}`);
  assert.equal(device.name, 'My OpenSprinkler');
  assert.deepEqual(device.params, [
    { name: 'host', value: '192.0.2.10' },
    { name: 'firmware', value: '2.2.1(6)' },
    { name: 'hardware', value: 'Demo' },
  ]);
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: device.external_id,
    transport: 'local',
  });
});

test('no state is sent before the device is added; all of them once it is', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.states.length, 0);
  await createAll(w);
  const features = w.fake.discoveredDevices[0].features;
  for (const feature of features) {
    assert.equal(typeof w.fake.lastState(feature.external_id), 'number', feature.name);
  }
  assert.equal(w.fake.lastState(featureId(w.gladys, 'water_level')), 80);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'program_0')), 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'program_1')), 0);
  assert.ok(w.fake.widgetRefreshes.includes('controller'));
});

test('only the changes are published, and a heartbeat every 12 hours', async (t) => {
  const w = await world(t);
  await createAll(w);
  const count = () => w.fake.states.length;
  const before = count();
  await w.hub.pollAll({ force: true });
  assert.equal(count(), before, 'nothing changed, nothing sent');

  w.controller.all.status.sn[2] = 1;
  await w.hub.pollAll({ force: true });
  assert.deepEqual(w.fake.states.slice(before), [
    { device_feature_external_id: featureId(w.gladys, 'station_2'), state: 1 },
  ]);

  // The SDK times the heartbeat with Date.now.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 12 * 60 * 60_000 + 1 });
  const again = count();
  await w.hub.pollAll({ force: true });
  assert.equal(count() - again, w.fake.discoveredDevices[0].features.length);
});

test('a station switch runs the station for the configured time, and stops it', async (t) => {
  const w = await world(t, {
    world: {
      config: {
        controller_1_url: URL_1,
        controller_1_password: DEFAULT_PASSWORD,
        station_minutes: '15',
      },
    },
  });
  await createAll(w);
  const [device] = w.fake.discoveredDevices;
  const ack = await w.fake.setValue(device, featureOf(w, 'station_2'), 1);
  assert.deepEqual(ack, { success: true });
  assert.deepEqual(w.controller.requests.find((r) => r.path === '/cm').params, {
    sid: '2',
    en: '1',
    t: '900',
  });
  assert.equal(w.fake.lastState(featureId(w.gladys, 'station_2')), 1, 'read back at once');

  assert.deepEqual(await w.fake.setValue(device, featureOf(w, 'station_2'), 0), { success: true });
  assert.equal(w.fake.lastState(featureId(w.gladys, 'station_2')), 0);
  // Stopping a station that does not water is not an error.
  assert.deepEqual(await w.fake.setValue(device, featureOf(w, 'station_2'), 0), { success: true });
});

test('a refused command answers in the configured language', async (t) => {
  const w = await world(t, {
    world: {
      config: { controller_1_url: URL_1, controller_1_password: DEFAULT_PASSWORD, language: 'fr' },
    },
  });
  await createAll(w);
  const [device] = w.fake.discoveredDevices;
  await w.fake.setValue(device, featureOf(w, 'station_0'), 1);
  const again = await w.fake.setValue(device, featureOf(w, 'station_0'), 1);
  assert.equal(again.success, false);
  assert.match(again.error, /arrose déjà ou attend son tour/);
  const master = await w.fake.setValue(device, featureOf(w, 'station_7'), 1);
  assert.equal(master.success, false);
  assert.match(master.error, /station maître/);
});

test('the controller switch and the program switches', async (t) => {
  const w = await world(t);
  await createAll(w);
  const [device] = w.fake.discoveredDevices;
  await w.fake.setValue(device, featureOf(w, 'enabled'), 0);
  assert.equal(w.controller.settings.en, 0);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'enabled')), 0);
  await w.fake.setValue(device, featureOf(w, 'program_1'), 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'program_1')), 1);
  const unknown = await w.fake.setValue(device, featureOf(w, 'water_level'), 1);
  assert.equal(unknown.success, false);
});

test('scene actions: water a station, start a program, rain delay, stop everything', async (t) => {
  const w = await world(t);
  await createAll(w);
  const device = deviceId(w.gladys);

  let ack = await w.fake.sceneAction('run_station', { device, station: 5, minutes: 7 });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.controller.settings.ps[4].slice(0, 2), [99, 420]);

  ack = await w.fake.sceneAction('run_station', { device, station: 9, minutes: 7 });
  assert.equal(ack.success, false);
  ack = await w.fake.sceneAction('run_station', { device, station: 1, minutes: 5000 });
  assert.equal(ack.success, false);

  ack = await w.fake.sceneAction('run_program', { device, program: 1, use_weather: true });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.controller.requests.at(-2), {
    path: '/mp',
    params: { pid: '0', uwt: '1' },
  });
  ack = await w.fake.sceneAction('run_program', { device, program: 3 });
  assert.equal(ack.success, false);

  ack = await w.fake.sceneAction('set_rain_delay', { device, hours: 48 });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'rain_delay')), 48);
  ack = await w.fake.sceneAction('set_rain_delay', { device, hours: 0 });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'rain_delay')), 0);

  ack = await w.fake.sceneAction('stop_watering', { device });
  assert.equal(ack.success, true, ack.error);
  assert.ok(w.controller.settings.ps.every(([pid]) => pid === 0));
});

test('"station finished" fires when a run ends, with its duration and origin', async (t) => {
  const w = await world(t);
  await createAll(w);
  assert.equal(w.fake.sceneEvents.length, 0, 'nothing at start-up');
  await w.fake.sceneAction('run_station', { device: deviceId(w.gladys), station: 3, minutes: 2 });
  w.controller.advance(120);
  await w.hub.pollAll({ force: true });
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: 'station_finished',
      data: {
        device: deviceId(w.gladys),
        controller: 'My OpenSprinkler',
        station: 3,
        station_name: 'Vegetable garden',
        duration_minutes: 2,
        origin: 'manual',
      },
    },
  ]);
  await w.hub.pollAll({ force: true });
  assert.equal(w.fake.sceneEvents.length, 1, 'once per run');
});

test('a controller that stops answering: one event, the badge, the status, the way back', async (t) => {
  const w = await world(t);
  w.controller.online = false;
  await w.hub.pollAll({ force: true });
  assert.equal(w.fake.sceneEvents.length, 0, 'one failure is a blip');
  await w.hub.pollAll({ force: true });
  await w.hub.pollAll({ force: true });
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: 'controller_unreachable',
      data: {
        device: deviceId(w.gladys),
        controller: 'My OpenSprinkler',
        error: 'does not answer',
      },
    },
  ]);
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /My OpenSprinkler: does not answer/);

  w.controller.online = true;
  await w.hub.pollAll({ force: true });
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('a refused password is reported, and fires no "unreachable" event', async (t) => {
  const w = await world(t, {
    world: { config: { controller_1_url: URL_1, controller_1_password: 'wrong', language: 'en' } },
  });
  await w.hub.pollAll({ force: true });
  await w.hub.pollAll({ force: true });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /password refused/);
  assert.deepEqual(w.fake.sceneEvents, []);
  assert.deepEqual(w.fake.discoveredDevices, [], 'nothing known about the controller yet');
});

test('the water meter adds the pulses, survives a restart and a controller reboot', async (t) => {
  const state = variant(IDLE, (all) => {
    all.settings.flcto = 1000;
  });
  const controller = new FakeOpenSprinkler({ state });
  const w = await world(t, { controller });
  await createAll(w);
  const meter = () => w.fake.lastState(featureId(w.gladys, 'water_counter'));
  assert.equal(meter(), 0, 'starts at 0');

  controller.settings.flcto = 1040; // 40 pulses of 2.5 L
  await w.hub.pollAll({ force: true });
  assert.equal(meter(), 100);

  controller.settings.flcto = 8; // rebooted: counts from 0 again
  await w.hub.pollAll({ force: true });
  assert.equal(meter(), 120);

  await w.app.stop();
  const saved = JSON.parse(readFileSync(join(w.dataDir, 'opensprinkler-state.json'), 'utf8'));
  assert.deepEqual(saved.counters[MAC_1], { liters: 120, pulses: 8 });

  // A new container on the same /data: the total goes on.
  const again = await createWorld({
    controllers: { [URL_1]: controller },
    dataDir: w.dataDir,
    devices: w.fake.devices,
  });
  t.after(() => again.app.stop());
  controller.settings.flcto = 12;
  await again.hub.pollAll({ force: true });
  assert.equal(again.fake.lastState(featureId(again.gladys, 'water_counter')), 130);
});

test('flow rate in m³/h', async (t) => {
  const state = variant(IDLE, (all) => {
    all.settings.flcrt = 40; // 6 L/min
  });
  const w = await world(t, { fake: { state } });
  await createAll(w);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'flow_rate')), 0.36);
});

test('a station renamed on the controller republishes the device', async (t) => {
  const w = await world(t);
  const published = () => w.fake.requests.filter((r) => r.path === '/discovered_device').length;
  const before = published();
  w.controller.all.stations.snames[0] = 'Lawn north';
  await w.hub.pollAll({ force: true });
  assert.equal(published(), before + 1);
  assert.equal(w.fake.discoveredDevices[0].features[1].name, 'Lawn north');
  await w.hub.pollAll({ force: true });
  assert.equal(published(), before + 1, 'once');
});

test('an offline controller is still published from what /data remembers', async (t) => {
  const controller = new FakeOpenSprinkler();
  const first = await createWorld({ controllers: { [URL_1]: controller } });
  await first.app.stop();

  controller.online = false;
  const w = await createWorld({ controllers: { [URL_1]: controller }, dataDir: first.dataDir });
  t.after(() => w.app.stop());
  assert.equal(w.fake.discoveredDevices.length, 1);
  assert.equal(w.fake.discoveredDevices[0].external_id, deviceId(w.gladys));
});

test('two controllers, one of them down: still connected, the message names it', async (t) => {
  const second = new FakeOpenSprinkler({
    state: variant(IDLE, (all) => {
      all.settings.mac = '02:00:5E:00:53:02';
      all.settings.dname = 'Orchard';
    }),
  });
  second.online = false;
  const w = await createWorld({
    controllers: { [URL_1]: new FakeOpenSprinkler(), [URL_2]: second },
    config: {
      controller_1_url: URL_1,
      controller_1_password: DEFAULT_PASSWORD,
      controller_2_url: '192.0.2.20:8080',
      controller_2_password: DEFAULT_PASSWORD,
      controller_2_name: 'Orchard',
      language: 'en',
    },
  });
  t.after(() => w.app.stop());
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.connectionStatus.message.en, 'Orchard: does not answer');

  // A command needs the controller when several are configured.
  const ack = await w.fake.sceneAction('stop_watering', {});
  assert.equal(ack.success, false);

  second.online = true;
  await w.hub.pollAll({ force: true });
  assert.equal(w.fake.discoveredDevices.length, 2);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('no address, an address not understood: the status says so', async (t) => {
  const empty = await createWorld({ config: {} });
  t.after(() => empty.app.stop());
  assert.equal(empty.fake.connectionStatus.connected, false);
  assert.match(empty.fake.connectionStatus.message.en, /Enter the address/);

  const bad = await createWorld({ config: { controller_1_url: 'http://user:pw@192.0.2.10' } });
  t.after(() => bad.app.stop());
  assert.match(bad.fake.connectionStatus.message.en, /Address not understood/);
});

test('"Test the connection" reports each controller', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'My OpenSprinkler: connected, firmware 2.2.1(6), 8 stations, 2 programs',
  );
  assert.match(ack.data.message.de, /verbunden/);
});

test('a reconnection to Gladys publishes everything again', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.ok(w.fake.states.length - before >= w.fake.discoveredDevices[0].features.length);
});

test('a new configuration reads the controllers again with it', async (t) => {
  const w = await world(t);
  await w.fake.configUpdated({
    controller_1_url: URL_1,
    controller_1_password: DEFAULT_PASSWORD,
    controller_1_name: 'Garden',
    language: 'en',
  });
  assert.equal(w.fake.discoveredDevices[0].name, 'Garden');
  await w.fake.configUpdated({});
  assert.deepEqual(w.fake.discoveredDevices, []);
});
