// -----------------------------------------------------------------------------
// End to end over real HTTP: the fake controller served on 127.0.0.1 (the
// loopback, no network), the real node:http client, the SDK's fake Gladys.
// Proves the request shape the firmware expects (GET, pw in the query) and
// the plain-text 404 of a firmware without /ja.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { httpGet } from '../src/opensprinkler/http.js';
import { Store } from '../src/store.js';
import { DEFAULT_PASSWORD, FakeOpenSprinkler } from './helpers/fakeOpenSprinkler.js';
import { featureId } from './helpers/world.js';

async function serve(t, options) {
  const controller = new FakeOpenSprinkler(options);
  const url = await controller.listen();
  t.after(() => controller.close());
  return { controller, url };
}

for (const legacy of [false, true]) {
  test(`discovery, states and a command over HTTP (${legacy ? 'firmware without /ja' : 'firmware 2.2.1'})`, async (t) => {
    const { controller, url } = await serve(t, {
      state: 'demo-2.2.1/manual-running.ja.json',
      legacy,
    });
    const gladys = createFakeGladys({
      config: { controller_1_url: url, controller_1_password: DEFAULT_PASSWORD, language: 'en' },
    });
    const app = registerHandlers(gladys, {
      store: new Store(mkdtempSync(join(tmpdir(), 'gladys-opensprinkler-e2e-'))),
      timers: false,
      timings: { settleMs: 0 },
    });
    t.after(() => app.stop());
    await gladys.connect();
    await app.ready;

    const [device] = gladys.fake.discoveredDevices;
    assert.equal(device.features.length, 16);
    await gladys.fake.deviceCreated(device);
    assert.equal(gladys.fake.lastState(featureId(gladys, 'station_0')), 1);

    const station = device.features.find((f) => f.external_id === featureId(gladys, 'station_0'));
    assert.deepEqual(await gladys.fake.setValue(device, station, 0), { success: true });
    assert.equal(gladys.fake.lastState(featureId(gladys, 'station_0')), 0);
    assert.deepEqual(
      controller.requests.filter((r) => r.path === '/cm').map((r) => r.params),
      [{ sid: '0', en: '0' }],
    );
  });
}

test('the HTTP function: a timeout, a refused connection', async (t) => {
  const { controller, url } = await serve(t);
  controller.handle = () => new Promise(() => {}); // never answers
  await assert.rejects(httpGet(`${url}/jc`, { timeoutMs: 100 }), { code: 'ETIMEDOUT' });
  await controller.close();
  await assert.rejects(httpGet(`${url}/jc`, { timeoutMs: 1000 }), { code: 'ECONNREFUSED' });
});
