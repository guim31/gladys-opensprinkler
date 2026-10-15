// -----------------------------------------------------------------------------
// OpenSprinkler HTTP API client (firmware 2.x, documented in the firmware
// repository: docs/docs/2.2.1/221_6_api.md).
//
// Every call is a GET with the MD5 hash of the device password in `pw`; the
// answers are JSON. Errors come back as HTTP 200 with `{"result": code}`
// (1 = success, 2 = unauthorized, 16/17/18 = bad parameter, 32 = page not
// found, 48 = not permitted), except /jo, which answers a wrong password
// with the firmware version alone (`{"fwv": 221}`).
//
// The controller runs a single-threaded web server (an ESP8266 on the
// OpenSprinkler 2.3/3.x): requests are sent one at a time, never in parallel.
// The password and its hash never leave this module: error messages name the
// endpoint, never the URL.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { httpGet } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer, timeout, HTTP error
  AUTH: 'auth', // password refused
  NOT_OPENSPRINKLER: 'not_opensprinkler', // something answers, not the OpenSprinkler API
  REFUSED: 'refused', // the controller refused a command (result code)
});

// Result codes of the API (see the table at the top of the API reference).
export const RESULT = Object.freeze({
  SUCCESS: 1,
  UNAUTHORIZED: 2,
  MISMATCH: 3,
  DATA_MISSING: 16,
  OUT_OF_RANGE: 17,
  DATA_FORMAT: 18,
  PAGE_NOT_FOUND: 32,
  NOT_PERMITTED: 48,
});

export class OpenSprinklerError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message
   * @param {number} [code] API result code
   */
  constructor(kind, message, code) {
    super(message);
    this.name = 'OpenSprinklerError';
    this.kind = kind;
    this.code = code;
  }
}

/** Lowercase MD5 hex digest, the only form of the password the API takes. */
export const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

// Seconds accepted by /cm (manual station run): 1 s to 18 h.
export const MAX_STATION_SECONDS = 64_800;
// Hours accepted by /cv rd (rain delay).
export const MAX_RAIN_DELAY_HOURS = 32_767;

export class OpenSprinklerClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL (`http://192.0.2.10`)
   * @param {string} options.password plain-text device password
   * @param {Function} [options.request] HTTP seam, `(url, { timeoutMs }) => { status, body }`
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, password, request = httpGet, timeoutMs = 10_000 }) {
    this.url = url.replace(/\/+$/, '');
    this.hash = md5(password ?? '');
    this.request = request;
    this.timeoutMs = timeoutMs;
    // /ja (everything in one answer) exists since firmware 2.1.6; older
    // firmwares answer "page not found" and are read endpoint by endpoint.
    this.useJa = true;
    this.queue = Promise.resolve();
  }

  /**
   * One API call, queued behind the previous ones.
   * @param {string} path `/jc`
   * @param {Record<string, string|number>} [params]
   * @returns {Promise<object>} the parsed JSON answer
   */
  call(path, params = {}) {
    const run = this.queue.then(() => this.send(path, params));
    this.queue = run.catch(() => {});
    return run;
  }

  async send(path, params) {
    const query = new URLSearchParams({ pw: this.hash });
    for (const [key, value] of Object.entries(params)) {
      query.set(key, String(value));
    }
    let response;
    try {
      response = await this.request(`${this.url}${path}?${query}`, { timeoutMs: this.timeoutMs });
    } catch (err) {
      throw new OpenSprinklerError(
        ERROR_KINDS.UNREACHABLE,
        `${path}: no answer (${err.code ?? err.message})`,
      );
    }
    if (response.status === 404) {
      // Unknown page: a plain-text "The requested page does not exist".
      throw new OpenSprinklerError(
        ERROR_KINDS.NOT_OPENSPRINKLER,
        `${path}: page not found`,
        RESULT.PAGE_NOT_FOUND,
      );
    }
    if (response.status >= 500 || response.status === 0) {
      throw new OpenSprinklerError(ERROR_KINDS.UNREACHABLE, `${path}: HTTP ${response.status}`);
    }
    if (response.status !== 200) {
      throw new OpenSprinklerError(
        ERROR_KINDS.NOT_OPENSPRINKLER,
        `${path}: HTTP ${response.status}`,
      );
    }
    let data;
    try {
      data = JSON.parse(response.body);
    } catch {
      throw new OpenSprinklerError(ERROR_KINDS.NOT_OPENSPRINKLER, `${path}: not a JSON answer`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new OpenSprinklerError(ERROR_KINDS.NOT_OPENSPRINKLER, `${path}: unexpected answer`);
    }
    const keys = Object.keys(data);
    if (typeof data.result === 'number' && keys.every((key) => ['result', 'item'].includes(key))) {
      if (data.result === RESULT.SUCCESS) {
        return data;
      }
      if (data.result === RESULT.UNAUTHORIZED) {
        throw new OpenSprinklerError(ERROR_KINDS.AUTH, `${path}: password refused`, data.result);
      }
      throw new OpenSprinklerError(
        data.result === RESULT.PAGE_NOT_FOUND ? ERROR_KINDS.NOT_OPENSPRINKLER : ERROR_KINDS.REFUSED,
        `${path}: refused (result ${data.result})`,
        data.result,
      );
    }
    // /jo answers a wrong password with the firmware version alone.
    if (keys.length === 1 && keys[0] === 'fwv') {
      throw new OpenSprinklerError(
        ERROR_KINDS.AUTH,
        `${path}: password refused`,
        RESULT.UNAUTHORIZED,
      );
    }
    return data;
  }

  /**
   * The whole controller state, in the /ja shape:
   * `{ settings, options, stations, status, programs }`.
   */
  async readAll() {
    if (this.useJa) {
      try {
        const all = await this.call('/ja');
        if (all.settings && all.options && all.stations && all.status && all.programs) {
          return all;
        }
        throw new OpenSprinklerError(ERROR_KINDS.NOT_OPENSPRINKLER, '/ja: unexpected answer');
      } catch (err) {
        if (err.code !== RESULT.PAGE_NOT_FOUND) {
          throw err;
        }
        this.useJa = false;
      }
    }
    // One endpoint after the other, as the controller serves one at a time.
    const settings = await this.call('/jc');
    const options = await this.call('/jo');
    const stations = await this.call('/jn');
    const status = await this.call('/js');
    const programs = await this.call('/jp');
    return { settings, options, stations, status, programs };
  }

  // --- Commands ---------------------------------------------------------------

  /** Open a station for `seconds` (queued behind the running ones). */
  runStation(index, seconds) {
    const t = Math.min(MAX_STATION_SECONDS, Math.max(1, Math.round(seconds)));
    return this.call('/cm', { sid: index, en: 1, t });
  }

  stopStation(index) {
    return this.call('/cm', { sid: index, en: 0 });
  }

  /** Stop every running and queued station. */
  stopAll() {
    return this.call('/cv', { rsn: 1 });
  }

  /**
   * Start a program now. The firmware default (`qo` omitted) replaces what
   * runs: the same on every firmware, older ones know no queue option.
   * @param {number} index 0-based program index
   * @param {boolean} useWeather apply the current watering level
   */
  runProgram(index, useWeather) {
    return this.call('/mp', { pid: index, uwt: useWeather ? 1 : 0 });
  }

  setProgramEnabled(index, enabled) {
    return this.call('/cp', { pid: index, en: enabled ? 1 : 0 });
  }

  /** Enable or disable the controller operation (persists across reboots). */
  setEnabled(enabled) {
    return this.call('/cv', { en: enabled ? 1 : 0 });
  }

  /** Rain delay in hours, 0 cancels it. */
  setRainDelay(hours) {
    const rd = Math.min(MAX_RAIN_DELAY_HOURS, Math.max(0, Math.round(hours)));
    return this.call('/cv', { rd });
  }
}
