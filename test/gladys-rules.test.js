// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: the answers recorded on the OpenSprinkler firmware 2.2.1(6) (idle,
// manual runs, a program with a rain delay, a disabled controller), plus
// variants for the sensors the Demo build cannot simulate (a flow meter with
// pulses, a soil sensor, the old single rain sensor), clashing names, in every
// feature-name language. (Adapted from guim31/gladys-wled.)
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_PASSWORD,
  FakeOpenSprinkler,
  URL_1,
  createAll,
  createWorld,
  variant,
} from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const IDLE = 'demo-2.2.1/configured-idle.ja.json';

const states = {
  idle: IDLE,
  'manual runs': 'demo-2.2.1/manual-running.ja.json',
  'program and rain delay': 'demo-2.2.1/program-running-raindelay.ja.json',
  disabled: 'demo-2.2.1/disabled.ja.json',
  'flow meter with pulses and a soil sensor': variant(IDLE, (all) => {
    all.settings.flcrt = 40;
    all.settings.flcto = 5000;
    all.options.sn2t = 3;
  }),
  'old single rain sensor, no flow': variant(IDLE, (all) => {
    delete all.options.sn1t;
    delete all.options.sn2t;
    all.options.urs = 1;
    all.settings.rs = 0;
  }),
  'clashing and empty station names': variant(IDLE, (all) => {
    all.stations.snames = ['Lawn', 'Lawn', '', 'Rain delay', 'Watering level', 'S06', 'S07', ''];
    all.programs.pd[1][5] = '';
  }),
  'sixteen stations': variant(IDLE, (all) => {
    all.status.nstations = 16;
    all.status.sn = [...all.status.sn, 0, 0, 0, 0, 0, 0, 0, 1];
    all.stations.snames = [
      ...all.stations.snames,
      ...Array.from({ length: 8 }, (_, i) => `Z${i + 9}`),
    ];
    all.settings.ps = [...all.settings.ps, ...Array.from({ length: 8 }, () => [0, 0, 0, 0])];
    all.settings.ps[15] = [99, 120, all.settings.devt, 0];
  }),
};

const scenarios = [];
for (const [label, state] of Object.entries(states)) {
  scenarios.push({ label, state, language: 'en' });
}
for (const language of ['fr', 'de', 'es']) {
  scenarios.push({
    label: `${language} names`,
    state: states['clashing and empty station names'],
    language,
  });
}

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label}, ${scenario.language})`, async () => {
    const controller = new FakeOpenSprinkler({ state: scenario.state });
    const world = await createWorld({
      controllers: { [URL_1]: controller },
      config: {
        controller_1_url: URL_1,
        controller_1_password: DEFAULT_PASSWORD,
        language: scenario.language,
      },
    });
    const { gladys, app } = world;
    try {
      await createAll(world);
      const devices = gladys.fake.discoveredDevices;
      assert.equal(devices.length, 1);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            assert.ok(
              !allowed || allowed.includes(feature.unit),
              `${at}: unit ${feature.unit} not offered for ${feature.category}`,
            );
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(feature.name.trim() !== '', `${at}: empty name`);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // The value read from the fixtures fits the declared bounds.
          const value = gladys.fake.lastState(feature.external_id);
          assert.equal(typeof value, 'number', `${at}: no state published`);
          assert.ok(value >= feature.min && value <= feature.max, `${at}: ${value} out of bounds`);
          if (feature.type === 'integer' || feature.type === 'binary') {
            assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
          }
        }
      }
    } finally {
      await app.stop();
    }
  });
}
