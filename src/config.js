// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to three OpenSprinkler controllers, each in its own slot (address,
// password, optional name). The device identity is the controller's MAC
// address, read from the controller: moving a controller from one slot to
// another, or changing its address, keeps its device and history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3];

// Reading intervals offered in the configuration, in seconds. The controller
// is a small device (an ESP8266 on the OpenSprinkler 2.3/3.x): every 30 s is
// the fastest pace worth asking of it.
export const POLL_INTERVALS = ['30', '60'];

// How long a station runs when its switch is turned on in Gladys, in minutes.
export const STATION_MINUTES = ['5', '10', '15', '20', '30', '45', '60'];

// Unit of the "flow pulse rate" set in the OpenSprinkler options (the volume
// of water per flow-sensor pulse): the controller does not know it.
export const FLOW_UNITS = ['liter', 'gallon'];

export const DEFAULT_CONFIG = {
  controller_1_url: '',
  controller_1_password: '',
  controller_1_name: '',
  controller_2_url: '',
  controller_2_password: '',
  controller_2_name: '',
  controller_3_url: '',
  controller_3_password: '',
  controller_3_name: '',
  poll_interval: '30',
  station_minutes: '10',
  flow_unit: 'liter',
  language: 'fr',
};

const MAX_NAME_LENGTH = 40;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, `sprinkler.local:8080`), or the URL copied from the browser
 * (`http://192.0.2.10/`). HTTP by default, the path dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port]`, null when unusable
 */
export function parseControllerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  return url.origin;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const controllers = [];
  const invalidSlots = [];
  for (const slot of SLOTS) {
    const typed = text(`controller_${slot}_url`);
    if (!typed) {
      continue;
    }
    const url = parseControllerUrl(typed);
    if (!url) {
      invalidSlots.push(slot);
      continue;
    }
    controllers.push({
      slot,
      url,
      // Passwords are kept as typed: spaces may be part of them. An empty
      // password stays empty: the controller may run with "ignore password".
      password:
        typeof source[`controller_${slot}_password`] === 'string'
          ? source[`controller_${slot}_password`]
          : '',
      name: text(`controller_${slot}_name`).slice(0, MAX_NAME_LENGTH) || null,
    });
  }

  return {
    controllers,
    invalidSlots,
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    stationMinutes: Number(pick('station_minutes', STATION_MINUTES)),
    flowUnit: pick('flow_unit', FLOW_UNITS),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
