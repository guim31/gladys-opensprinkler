// -----------------------------------------------------------------------------
// From the raw API answers (the /ja shape) to a plain snapshot of the
// controller. Pure functions, tested against answers recorded on the
// OpenSprinkler firmware itself (test/fixtures/opensprinkler/).
//
// Field meanings: the firmware API reference 2.2.1(6). Older firmwares name
// some fields differently (`urs`/`rso`/`rs` before the two sensor inputs):
// both spellings are read.
// -----------------------------------------------------------------------------

// Special program ids in the station status (`ps`) and the last run (`lrun`).
export const PID_MANUAL = 99;
export const PID_RUN_ONCE = 254;

// Built-in sensor types (`sn1t`, `sn2t`).
export const SENSOR_TYPES = Object.freeze({
  0: null,
  1: 'rain',
  2: 'flow',
  3: 'soil',
  240: 'program_switch',
});

const GALLON_LITERS = 3.785411784;

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** 221 + 6 → "2.2.1(6)". */
export function firmwareName(fwv, fwm) {
  const version = num(fwv);
  if (version === null) {
    return null;
  }
  const text = `${Math.floor(version / 100)}.${Math.floor(version / 10) % 10}.${version % 10}`;
  return num(fwm) === null ? text : `${text}(${fwm})`;
}

/** Hardware version (`hwv`) → a readable model. */
export function hardwareName(hwv) {
  const version = num(hwv);
  if (version === null) {
    return null;
  }
  const names = { 64: 'OpenSprinkler Pi', 128: 'OpenSprinkler Beagle', 192: 'Linux', 255: 'Demo' };
  if (names[version]) {
    return names[version];
  }
  return `OpenSprinkler ${Math.floor(version / 10) % 10}.${version % 10}`;
}

/** Bit `index` of an array of 8-station bytes (LSB first). */
export function stationBit(bytes, index) {
  if (!Array.isArray(bytes)) {
    return false;
  }
  const byte = num(bytes[Math.floor(index / 8)]);
  return byte !== null && ((byte >> (index % 8)) & 1) === 1;
}

/** MAC address → the stable platform id of the controller (`02fc00000001`). */
export function macId(mac) {
  if (typeof mac !== 'string') {
    return null;
  }
  const hex = mac.toLowerCase().replace(/[^0-9a-f]/g, '');
  return /^[0-9a-f]{12}$/.test(hex) && !/^0{12}$/.test(hex) ? hex : null;
}

/**
 * @param {object} all the /ja answer (`{ settings, options, stations, status, programs }`)
 * @param {object} [options]
 * @param {'liter'|'gallon'} [options.flowUnit] unit of the flow pulse rate
 */
export function parseState(all, { flowUnit = 'liter' } = {}) {
  const settings = all.settings ?? {};
  const options = all.options ?? {};
  const stationData = all.stations ?? {};
  const status = all.status ?? {};
  const programData = all.programs ?? {};

  const names = Array.isArray(stationData.snames) ? stationData.snames : [];
  const count = num(status.nstations) ?? names.length;
  const running = Array.isArray(status.sn) ? status.sn : [];
  const ps = Array.isArray(settings.ps) ? settings.ps : [];
  const masters = new Set(
    ['mas', 'mas2', 'mas3', 'mas4'].map((key) => num(options[key])).filter((value) => value > 0),
  );

  const stations = [];
  for (let index = 0; index < count; index += 1) {
    const [pid = 0, remaining = 0, start = 0] = Array.isArray(ps[index]) ? ps[index] : [];
    const isRunning = running[index] === 1;
    stations.push({
      index,
      name: typeof names[index] === 'string' && names[index].trim() ? names[index].trim() : null,
      running: isRunning,
      // In the queue but not open yet (sequential groups, a pause).
      queued: !isRunning && num(pid) > 0,
      pid: num(pid) ?? 0,
      remaining: num(remaining) ?? 0,
      start: num(start) ?? 0,
      disabled: stationBit(stationData.stn_dis, index),
      // Master numbers are 1-based.
      master: masters.has(index + 1),
    });
  }

  const programs = (Array.isArray(programData.pd) ? programData.pd : []).map((entry, index) => {
    const flag = Array.isArray(entry) ? num(entry[0]) : null;
    const name = Array.isArray(entry) && typeof entry[5] === 'string' ? entry[5].trim() : '';
    return {
      index,
      name: name || null,
      enabled: flag !== null && (flag & 1) === 1,
      useWeather: flag !== null && (flag & 2) === 2,
    };
  });

  // Built-in sensor inputs. Firmwares before the two inputs used `urs` (type),
  // `rso` (option) and `rs` (status) for the one rain sensor.
  const sensors = [];
  const sensor1Type = num(options.sn1t) ?? num(options.urs);
  const sensor1Active = num(settings.sn1) ?? num(settings.rs);
  if (SENSOR_TYPES[sensor1Type]) {
    sensors.push({ input: 1, type: SENSOR_TYPES[sensor1Type], active: sensor1Active === 1 });
  }
  const sensor2Type = num(options.sn2t);
  if (SENSOR_TYPES[sensor2Type]) {
    sensors.push({ input: 2, type: SENSOR_TYPES[sensor2Type], active: num(settings.sn2) === 1 });
  }

  // The flow sensor (input 1 only): pulses scaled to a window of `flwrt`
  // seconds (`flcrt`), the pulses since power-on (`flcto`), and the volume
  // per pulse `((fpr1 << 8) + fpr0) / 100` in the unit chosen in the app.
  let flow = null;
  if (sensors.some((sensor) => sensor.type === 'flow')) {
    const pulseVolume = (((num(options.fpr1) ?? 0) << 8) + (num(options.fpr0) ?? 0)) / 100;
    const literPerPulse = pulseVolume * (flowUnit === 'gallon' ? GALLON_LITERS : 1);
    const window = num(settings.flwrt);
    const scaled = num(settings.flcrt);
    const litersPerMinute =
      window && window > 0 && scaled !== null ? (scaled / window) * 60 * literPerPulse : 0;
    flow = {
      literPerPulse,
      litersPerMinute,
      totalPulses: num(settings.flcto),
    };
  }

  // Device time (`devt`) and rain delay end (`rdst`) are both local epochs.
  const deviceTime = num(settings.devt) ?? 0;
  const rainDelayActive = num(settings.rd) === 1;
  const rainDelayEnd = num(settings.rdst) ?? 0;
  const rainDelayHours =
    rainDelayActive && rainDelayEnd > deviceTime
      ? Math.ceil((rainDelayEnd - deviceTime) / 3600)
      : 0;

  const lrun = Array.isArray(settings.lrun) ? settings.lrun : [];
  const lastRun =
    num(lrun[3]) > 0
      ? { station: num(lrun[0]), pid: num(lrun[1]), duration: num(lrun[2]) ?? 0, end: lrun[3] }
      : null;

  return {
    mac: macId(settings.mac),
    deviceName:
      typeof settings.dname === 'string' && settings.dname.trim() ? settings.dname.trim() : null,
    firmware: firmwareName(options.fwv, options.fwm),
    hardware: hardwareName(options.hwv),
    enabled: num(settings.en) === 1,
    deviceTime,
    stations,
    programs,
    waterLevel: num(options.wl),
    rainDelay: { active: rainDelayActive, hours: rainDelayHours },
    paused: num(settings.pq) === 1,
    pauseSeconds: num(settings.pt) ?? 0,
    sensors,
    flow,
    lastRun,
  };
}

/**
 * What decides the feature list of the device: when it changes, Gladys
 * offers "Update" in the Discovery tab.
 */
export function structureOf(snapshot) {
  return {
    stations: snapshot.stations.map((station) => station.name),
    programs: snapshot.programs.map((program) => program.name),
    sensors: snapshot.sensors.map((sensor) => sensor.type),
    counter: snapshot.flow ? snapshot.flow.totalPulses !== null : false,
  };
}

/** How a run was started, from its program id. */
export function originOf(pid) {
  if (pid === PID_MANUAL) {
    return 'manual';
  }
  if (pid === PID_RUN_ONCE) {
    return 'run_once';
  }
  return 'program';
}
