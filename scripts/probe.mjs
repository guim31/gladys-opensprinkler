#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real OpenSprinkler controller, with the integration's
// own client and parser: what the integration would see, nothing changed on
// the controller (only GET /jo, /jc and /ja, or the five read endpoints of an
// old firmware; no /cm, /cv, /cp, /mp).
//
//   OS_PASSWORD='device password' node scripts/probe.mjs 192.168.1.20[:port]
//
// Prints nothing sensitive: no password nor hash, no MAC address, no station
// or program names, no location, no device name (counts and types only).
// OS_PASSWORD defaults to the factory password, `opendoor`.
// -----------------------------------------------------------------------------

import { parseControllerUrl } from '../src/config.js';
import { OpenSprinklerClient } from '../src/opensprinkler/client.js';
import { parseState, structureOf } from '../src/opensprinkler/model.js';

const address = process.argv[2];
const url = parseControllerUrl(address);
if (!url) {
  console.error('Usage: OS_PASSWORD=... node scripts/probe.mjs <controller address>');
  process.exit(2);
}
const password = process.env.OS_PASSWORD ?? 'opendoor';
const line = (label, value) => console.log(`${label.padEnd(34)} ${value}`);
const failure = (err) => `${err.kind ?? 'error'}: ${err.message}`;

// 1. Without the password: /jo answers the firmware version alone.
const anonymous = new OpenSprinklerClient({ url, password: `wrong-${Date.now()}` });
try {
  await anonymous.call('/jo');
  line('/jo with a wrong password', 'ACCEPTED (the controller ignores passwords?)');
} catch (err) {
  line('/jo with a wrong password', failure(err));
}
try {
  await anonymous.call('/jc');
  line('/jc with a wrong password', 'ACCEPTED (the controller ignores passwords?)');
} catch (err) {
  line('/jc with a wrong password', failure(err));
}

// 2. With the password: the whole state, as the integration reads it.
const client = new OpenSprinklerClient({ url, password });
const started = Date.now();
let all;
try {
  all = await client.readAll();
} catch (err) {
  line('Reading with the password', failure(err));
  process.exit(1);
}
line('Reading with the password', `ok in ${Date.now() - started} ms`);
line('Endpoint', client.useJa ? '/ja (one request)' : '/jc /jo /jn /js /jp (no /ja)');
line('Answer size', `${JSON.stringify(all).length} characters`);

const snapshot = parseState(all);
const structure = structureOf(snapshot);
line('Firmware', snapshot.firmware ?? 'unknown');
line(
  'Hardware',
  `${snapshot.hardware ?? 'unknown'} (hwv ${all.options.hwv}, hwt ${all.options.hwt})`,
);
line('MAC address', snapshot.mac ? 'present (stable device id)' : 'MISSING (slot used as id)');
line('Controller enabled', snapshot.enabled);
line(
  'Stations',
  `${snapshot.stations.length} (${snapshot.stations.filter((s) => s.master).length} master, ${snapshot.stations.filter((s) => s.disabled).length} disabled)`,
);
line(
  'Stations watering / waiting',
  `${snapshot.stations.filter((s) => s.running).length} / ${snapshot.stations.filter((s) => s.queued).length}`,
);
line(
  'Programs',
  `${snapshot.programs.length} (${snapshot.programs.filter((p) => p.enabled).length} enabled)`,
);
line('Watering level', `${snapshot.waterLevel} %`);
line('Rain delay', `${snapshot.rainDelay.hours} h`);
line('Paused', snapshot.paused);
line(
  'Sensors',
  snapshot.sensors
    .map((s) => `input ${s.input}: ${s.type}${s.active ? ' (active)' : ''}`)
    .join(', ') || 'none',
);
line(
  'Flow',
  snapshot.flow
    ? `${snapshot.flow.litersPerMinute.toFixed(2)} L/min, ${snapshot.flow.literPerPulse} per pulse, total pulses ${snapshot.flow.totalPulses ?? 'not reported'}`
    : 'no flow sensor',
);
line(
  'Last run',
  snapshot.lastRun
    ? `station ${snapshot.lastRun.station + 1}, ${snapshot.lastRun.duration} s, pid ${snapshot.lastRun.pid}`
    : 'none',
);
line(
  'Features the device would have',
  1 +
    structure.stations.length +
    structure.programs.length +
    2 +
    structure.sensors.filter((s) => s !== 'program_switch').length +
    (structure.counter ? 1 : 0),
);

// 3. The fields the integration reads, present or not on this firmware.
const fields = {
  settings: [
    'devt',
    'en',
    'rd',
    'rdst',
    'sn1',
    'sn2',
    'pq',
    'pt',
    'ps',
    'lrun',
    'mac',
    'dname',
    'flwrt',
    'flcrt',
    'flcto',
  ],
  options: ['fwv', 'fwm', 'hwv', 'wl', 'mas', 'mas2', 'sn1t', 'sn2t', 'fpr0', 'fpr1'],
  stations: ['snames', 'stn_dis'],
  status: ['sn', 'nstations'],
  programs: ['pd'],
};
for (const [part, keys] of Object.entries(fields)) {
  const missing = keys.filter((key) => !(key in (all[part] ?? {})));
  line(`Fields missing in ${part}`, missing.length ? missing.join(', ') : 'none');
}
