// -----------------------------------------------------------------------------
// One Gladys device per OpenSprinkler controller, and the values of its
// features.
//
// Identity: `gladys.externalIds('controller', <MAC address>)`. The MAC is the
// one id the controller gives itself; its stations and programs are numbered
// by index, the only id the API knows (a renamed station keeps its feature,
// a deleted program shifts the following ones: see the documentation).
//
// Feature keys are permanent: `enabled`, `station_<n>`, `program_<n>`,
// `water_level`, `rain_delay`, `rain_sensor`, `soil_sensor`, `flow_rate`,
// `water_counter` (n is the 0-based index on the controller).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { hostOf } from './config.js';
import { MAX_RAIN_DELAY_HOURS } from './opensprinkler/client.js';
import { NAMES } from './texts.js';

export const DEVICE_TYPE = 'controller';

// The core polls once a minute at the slowest. The container reads the
// controllers on its own timer (src/hub.js): this value only matters if the
// core polls too, and onPoll then skips what the timer just read.
export const POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES;

// Display bounds (the core never enforces min/max on a state).
const MAX_FLOW_M3H = 10;
const MAX_COUNTER_LITERS = 1_000_000_000;

export const deviceIds = (gladys, platformId) => gladys.externalIds(DEVICE_TYPE, platformId);

/** Platform id (MAC) of a device or feature external id of this integration, or null. */
export function platformIdOf(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  const prefix = deviceIds(gladys, '').device;
  if (!externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}

/** Feature key (`station_3`) of a feature external id. */
export function featureKeyOf(gladys, externalId) {
  const platformId = platformIdOf(gladys, externalId);
  if (!platformId) {
    return null;
  }
  const device = deviceIds(gladys, platformId).device;
  return externalId.startsWith(`${device}:`) ? externalId.slice(device.length + 1) : null;
}

const names = (language) => NAMES[language] ?? NAMES.fr;

/** The name shown for a station: its name on the controller, else "Station 3". */
export function stationName(name, index, language) {
  return name || `${names(language).station} ${index + 1}`;
}

/** The name shown for a program: "Program: Morning", else "Program 2". */
export function programName(name, index, language) {
  const word = names(language).program;
  if (!name) {
    return `${word} ${index + 1}`;
  }
  return language === 'fr' ? `${word} : ${name}` : `${word}: ${name}`;
}

/** Name of the device in Gladys: the configured name, the controller's own, or the brand. */
export function controllerName(controller, structure) {
  return controller.name || structure?.deviceName || 'OpenSprinkler';
}

const feature = (ids, key, name, spec) => ({
  name,
  external_id: ids.feature(key),
  selector: undefined,
  has_feedback: false,
  read_only: true,
  keep_history: true,
  ...spec,
});

/**
 * @param {object} gladys GladysIntegration (for the external ids)
 * @param {object} controller the configured controller (src/config.js)
 * @param {object} known `{ platformId, structure }` as read from the controller
 * @param {string} language feature names language
 */
export function buildDevice(gladys, controller, known, language) {
  const { platformId, structure } = known;
  const ids = deviceIds(gladys, platformId);
  const text = names(language);
  const features = [];
  const taken = new Set();
  const unique = (name) => {
    let candidate = name;
    for (let n = 2; taken.has(candidate); n += 1) {
      candidate = `${name} (${n})`;
    }
    taken.add(candidate);
    return candidate;
  };
  // The fixed names first: a station named "Rain delay" yields, not them.
  const fixed = Object.fromEntries(
    [
      'enabled',
      'waterLevel',
      'rainDelay',
      'rainSensor',
      'soilSensor',
      'flowRate',
      'waterCounter',
    ].map((key) => [key, unique(text[key])]),
  );

  features.push(
    feature(ids, 'enabled', fixed.enabled, {
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      read_only: false,
      has_feedback: true,
      min: 0,
      max: 1,
    }),
  );

  structure.stations.forEach((name, index) => {
    features.push(
      feature(ids, `station_${index}`, unique(stationName(name, index, language)), {
        category: CATEGORIES.SWITCH,
        type: TYPES.SWITCH.BINARY,
        read_only: false,
        has_feedback: true,
        min: 0,
        max: 1,
      }),
    );
  });

  structure.programs.forEach((name, index) => {
    features.push(
      feature(ids, `program_${index}`, unique(programName(name, index, language)), {
        category: CATEGORIES.SWITCH,
        type: TYPES.SWITCH.BINARY,
        read_only: false,
        has_feedback: true,
        min: 0,
        max: 1,
      }),
    );
  });

  features.push(
    feature(ids, 'water_level', fixed.waterLevel, {
      category: CATEGORIES.LEVEL_SENSOR,
      type: TYPES.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
      unit: UNITS.PERCENT,
      // 0 to 250 % on the controller.
      min: 0,
      max: 250,
    }),
    feature(ids, 'rain_delay', fixed.rainDelay, {
      category: CATEGORIES.DURATION,
      type: TYPES.DURATION.INTEGER,
      unit: UNITS.HOURS,
      min: 0,
      max: MAX_RAIN_DELAY_HOURS,
    }),
  );

  if (structure.sensors.includes('rain')) {
    features.push(
      feature(ids, 'rain_sensor', fixed.rainSensor, {
        category: CATEGORIES.RAIN_SENSOR,
        type: TYPES.SENSOR.BINARY,
        min: 0,
        max: 1,
      }),
    );
  }
  if (structure.sensors.includes('soil')) {
    features.push(
      feature(ids, 'soil_sensor', fixed.soilSensor, {
        category: CATEGORIES.INPUT,
        type: TYPES.INPUT.BINARY,
        min: 0,
        max: 1,
      }),
    );
  }
  if (structure.sensors.includes('flow')) {
    features.push(
      feature(ids, 'flow_rate', fixed.flowRate, {
        category: CATEGORIES.WATER_VALVE,
        type: TYPES.WATER_VALVE.FLOW,
        unit: UNITS.CUBIC_METER_PER_HOUR,
        min: 0,
        max: MAX_FLOW_M3H,
      }),
    );
    if (structure.counter) {
      features.push(
        feature(ids, 'water_counter', fixed.waterCounter, {
          category: CATEGORIES.VOLUME_SENSOR,
          type: TYPES.VOLUME_SENSOR.DECIMAL,
          unit: UNITS.LITER,
          min: 0,
          max: MAX_COUNTER_LITERS,
        }),
      );
    }
  }

  const params = [{ name: 'host', value: hostOf(controller.url) }];
  if (structure.firmware) {
    params.push({ name: 'firmware', value: structure.firmware });
  }
  if (structure.hardware) {
    params.push({ name: 'hardware', value: structure.hardware });
  }

  return {
    name: controllerName(controller, structure),
    external_id: ids.device,
    selector: undefined,
    model: structure.hardware ?? 'OpenSprinkler',
    should_poll: true,
    poll_frequency: POLL_FREQUENCY,
    params,
    features: features.map(({ selector: _selector, ...rest }) => rest),
  };
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * The state of every feature, from a snapshot (src/opensprinkler/model.js).
 * @param {object} gladys
 * @param {string} platformId
 * @param {object} snapshot
 * @param {object} [extra] `{ waterCounterLiters }` kept by the hub across readings
 * @returns {Array<{ device_feature_external_id: string, state: number }>}
 */
export function featureStates(gladys, platformId, snapshot, extra = {}) {
  const ids = deviceIds(gladys, platformId);
  const states = [];
  const push = (key, value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  push('enabled', snapshot.enabled ? 1 : 0);
  for (const station of snapshot.stations) {
    push(`station_${station.index}`, station.running ? 1 : 0);
  }
  for (const program of snapshot.programs) {
    push(`program_${program.index}`, program.enabled ? 1 : 0);
  }
  push('water_level', snapshot.waterLevel);
  push('rain_delay', snapshot.rainDelay.hours);
  const active = (type) => {
    const inputs = snapshot.sensors.filter((sensor) => sensor.type === type);
    return inputs.length ? (inputs.some((sensor) => sensor.active) ? 1 : 0) : null;
  };
  push('rain_sensor', active('rain'));
  push('soil_sensor', active('soil'));
  if (snapshot.flow) {
    // L/min → m³/h.
    push('flow_rate', round(snapshot.flow.litersPerMinute * 0.06, 3));
    if (typeof extra.waterCounterLiters === 'number') {
      push('water_counter', round(extra.waterCounterLiters, 1));
    }
  }
  return states;
}
