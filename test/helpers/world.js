// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake OpenSprinkler controllers
// on a fake network, a temporary /data and a manual clock, with the
// integration wired on top through registerHandlers. No timer runs unless
// `timers: true` (with node:test mock timers): the tests read the
// controllers with `world.hub.pollAll()`. (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import {
  DEFAULT_PASSWORD,
  FakeOpenSprinkler,
  createNetwork,
  fixture,
} from './fakeOpenSprinkler.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const URL_1 = 'http://192.0.2.10';
export const URL_2 = 'http://192.0.2.20:8080';
// The MAC address of the recorded Demo firmware (a locally administered one).
export const MAC_1 = '02fc00000001';

/** A manual clock for the hub. */
export function createClock(start = Date.UTC(2026, 9, 14, 6, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {Record<string, FakeOpenSprinkler>} [options.controllers] by base URL
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  clock = createClock(),
  controllers,
  config = {
    controller_1_url: URL_1,
    controller_1_password: DEFAULT_PASSWORD,
    language: 'en',
  },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-opensprinkler-')),
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork(controllers ?? { [URL_1]: new FakeOpenSprinkler() });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings: { settleMs: 0, ...timings },
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, network, app, hub: app.hub, clock, dataDir };
}

export const deviceId = (gladys, mac = MAC_1) => gladys.externalIds('controller', mac).device;
export const featureId = (gladys, key, mac = MAC_1) =>
  gladys.externalIds('controller', mac).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

/** The recorded /ja answer, with some fields changed (synthetic variants). */
export function variant(name, change) {
  const all = fixture(name);
  change(all);
  return all;
}

export { DEFAULT_PASSWORD, FakeOpenSprinkler, fixture };
