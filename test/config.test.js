// -----------------------------------------------------------------------------
// Configuration normalization: what the user types becomes clean values.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hostOf, normalizeConfig, parseControllerUrl } from '../src/config.js';

test('defaults: no controller, 30 s, 10 min, liters, French', () => {
  assert.deepEqual(normalizeConfig(), {
    controllers: [],
    invalidSlots: [],
    pollIntervalMs: 30_000,
    stationMinutes: 10,
    flowUnit: 'liter',
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), normalizeConfig({}));
});

test('addresses: a bare IP, a port, the URL copied from the browser', () => {
  assert.equal(parseControllerUrl('192.0.2.10'), 'http://192.0.2.10');
  assert.equal(parseControllerUrl(' 192.0.2.10:8080 '), 'http://192.0.2.10:8080');
  assert.equal(parseControllerUrl('http://sprinkler.local/#/home'), 'http://sprinkler.local');
  assert.equal(parseControllerUrl('https://192.0.2.10/'), 'https://192.0.2.10');
  assert.equal(parseControllerUrl('ftp://192.0.2.10'), null);
  assert.equal(parseControllerUrl('http://admin:secret@192.0.2.10'), null, 'no credentials');
  assert.equal(parseControllerUrl(''), null);
  assert.equal(parseControllerUrl(42), null);
  assert.equal(hostOf('http://192.0.2.10:8080'), '192.0.2.10:8080');
});

test('three slots, the invalid ones reported, passwords kept as typed', () => {
  const config = normalizeConfig({
    controller_1_url: '192.0.2.10',
    controller_1_password: ' with spaces ',
    controller_1_name: '  Garden  ',
    controller_2_url: 'not a url at all',
    controller_3_url: '192.0.2.30',
    poll_interval: '60',
    station_minutes: 30,
    flow_unit: 'gallon',
    language: 'es',
  });
  assert.deepEqual(config.controllers, [
    { slot: 1, url: 'http://192.0.2.10', password: ' with spaces ', name: 'Garden' },
    { slot: 3, url: 'http://192.0.2.30', password: '', name: null },
  ]);
  assert.deepEqual(config.invalidSlots, [2]);
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.stationMinutes, 30);
  assert.equal(config.flowUnit, 'gallon');
  assert.equal(config.language, 'es');
});

test('values outside the offered options fall back to the defaults', () => {
  const config = normalizeConfig({
    poll_interval: '5',
    station_minutes: '999',
    flow_unit: 'barrel',
    language: 'it',
  });
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.stationMinutes, 10);
  assert.equal(config.flowUnit, 'liter');
  assert.equal(config.language, 'fr');
});
