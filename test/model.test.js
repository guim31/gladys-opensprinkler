// -----------------------------------------------------------------------------
// From the API answers to a snapshot, on answers recorded on the firmware
// 2.2.1(6) itself (test/fixtures/opensprinkler/README.md).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  firmwareName,
  hardwareName,
  macId,
  originOf,
  parseState,
  stationBit,
  structureOf,
} from '../src/opensprinkler/model.js';
import { fixture, variant } from './helpers/world.js';

test('an idle controller: stations, programs, sensors, identity', () => {
  const s = parseState(fixture('demo-2.2.1/configured-idle.ja.json'));
  assert.equal(s.mac, '02fc00000001');
  assert.equal(s.deviceName, 'My OpenSprinkler');
  assert.equal(s.firmware, '2.2.1(6)');
  assert.equal(s.hardware, 'Demo');
  assert.equal(s.enabled, true);
  assert.equal(s.waterLevel, 80);
  assert.deepEqual(
    s.stations.map((station) => station.name),
    [
      'Front lawn',
      'Back lawn',
      'Vegetable garden',
      'Drip hedges',
      'Roses',
      'Greenhouse',
      'Unused',
      'Master pump',
    ],
  );
  assert.ok(s.stations.every((station) => !station.running && !station.queued));
  assert.equal(s.stations[6].disabled, true, 'stn_dis 64 = the 7th station');
  assert.equal(s.stations[7].master, true, 'mas 8 = the 8th station');
  assert.deepEqual(
    s.programs.map(({ name, enabled }) => [name, enabled]),
    [
      ['Morning', true],
      ['Evening drip', false],
    ],
  );
  // sn1t 2 (flow), sn2t 1 (rain, active on the Demo build).
  assert.deepEqual(s.sensors, [
    { input: 1, type: 'flow', active: false },
    { input: 2, type: 'rain', active: true },
  ]);
  assert.equal(s.flow.literPerPulse, 2.5);
  assert.equal(s.flow.litersPerMinute, 0);
  assert.equal(s.flow.totalPulses, 0);
  assert.deepEqual(s.rainDelay, { active: false, hours: 0 });
  assert.equal(s.lastRun, null);
});

test('manual runs: running, master engaged, remaining time', () => {
  const s = parseState(fixture('demo-2.2.1/manual-running.ja.json'));
  const running = s.stations.filter((station) => station.running).map((station) => station.index);
  assert.deepEqual(running, [0, 1, 6, 7]);
  assert.equal(s.stations[0].pid, 99);
  assert.equal(s.stations[0].remaining, 599);
  assert.equal(s.stations[7].pid, 0, 'the master runs with no program of its own');
});

test('a program started by hand runs as "run-once" (pid 254), with the rain delay', () => {
  const s = parseState(fixture('demo-2.2.1/program-running-raindelay.ja.json'));
  assert.deepEqual(
    s.stations.slice(0, 4).map(({ running, queued, pid, remaining }) => ({
      running,
      queued,
      pid,
      remaining,
    })),
    [
      { running: true, queued: false, pid: 254, remaining: 719 },
      { running: false, queued: true, pid: 254, remaining: 480 },
      { running: false, queued: true, pid: 254, remaining: 240 },
      { running: false, queued: true, pid: 254, remaining: 960 },
    ],
  );
  assert.deepEqual(s.rainDelay, { active: true, hours: 24 });
  assert.deepEqual(s.lastRun, { station: 6, pid: 99, duration: 13, end: 1792070887 });
  assert.equal(originOf(s.lastRun.pid), 'manual');
  assert.equal(originOf(254), 'run_once');
  assert.equal(originOf(1), 'program');
});

test('a disabled controller', () => {
  const s = parseState(fixture('demo-2.2.1/disabled.ja.json'));
  assert.equal(s.enabled, false);
});

test('a pause keeps the stations in the queue', () => {
  const all = fixture('demo-2.2.1/configured-idle.ja.json');
  all.settings = fixture('demo-2.2.1/paused.jc.json');
  const s = parseState(all);
  assert.equal(s.paused, true);
  assert.equal(s.pauseSeconds, 598);
  assert.equal(s.stations[2].queued, true);
  assert.equal(s.stations[2].running, false);
});

test('flow rate and pulse volume, in liters or gallons', () => {
  // Synthetic: 40 pulses scaled to a 1000 s window (the Demo has no sensor).
  const all = variant('demo-2.2.1/configured-idle.ja.json', (data) => {
    data.settings.flcrt = 40;
    data.settings.flcto = 1234;
  });
  const liters = parseState(all);
  // 40 / 1000 pulses per second × 60 × 2.5 L.
  assert.equal(liters.flow.litersPerMinute, 6);
  assert.equal(liters.flow.totalPulses, 1234);
  const gallons = parseState(all, { flowUnit: 'gallon' });
  assert.ok(Math.abs(gallons.flow.litersPerMinute - 6 * 3.785411784) < 1e-9);
});

test('older field names: one rain sensor (urs, rs), no flcto', () => {
  const all = variant('demo-2.2.1/configured-idle.ja.json', (data) => {
    delete data.options.sn1t;
    delete data.options.sn2t;
    delete data.settings.sn1;
    data.options.urs = 1;
    data.settings.rs = 1;
  });
  const s = parseState(all);
  assert.deepEqual(s.sensors, [{ input: 1, type: 'rain', active: true }]);
  assert.equal(s.flow, null);
  assert.deepEqual(structureOf(s).sensors, ['rain']);
});

test('helpers: firmware, hardware, bits, MAC', () => {
  assert.equal(firmwareName(219, 2), '2.1.9(2)');
  assert.equal(firmwareName(221), '2.2.1');
  assert.equal(firmwareName(undefined), null);
  assert.equal(hardwareName(34), 'OpenSprinkler 3.4');
  assert.equal(hardwareName(64), 'OpenSprinkler Pi');
  assert.equal(stationBit([64], 6), true);
  assert.equal(stationBit([64], 5), false);
  assert.equal(stationBit([0, 1], 8), true);
  assert.equal(macId('02:FC:00:00:00:01'), '02fc00000001');
  assert.equal(macId('00:00:00:00:00:00'), null);
  assert.equal(macId(undefined), null);
});
