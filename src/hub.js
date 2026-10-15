// -----------------------------------------------------------------------------
// The OpenSprinkler hub: one record per configured controller, read on the
// container's own timer, its states published to Gladys when they change, its
// scene events fired on transitions, and the commands of the features, the
// widget and the scene actions.
//
// Gladys cannot be trusted to poll (GladysAssistant/Gladys#3198: a device
// created without `should_poll` is never polled, and keeps the polling fields
// it was created with). The devices are published with `should_poll: true`,
// but the timer below does the reading; `onPoll` stays as a fallback and skips
// a controller read less than 90 % of a period ago.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildDevice,
  controllerName,
  deviceIds,
  featureKeyOf,
  featureStates,
  platformIdOf,
} from './devices.js';
import { createIssueLog } from './issues.js';
import {
  ERROR_KINDS,
  MAX_STATION_SECONDS,
  OpenSprinklerClient,
  RESULT,
} from './opensprinkler/client.js';
import { originOf, parseState, structureOf } from './opensprinkler/model.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REFUSAL_TEXT,
  REPORT_TEXT,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'opensprinkler-hub' });

export const WIDGET_KEY = 'controller';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  STATION_FINISHED: 'station_finished',
  UNREACHABLE: 'controller_unreachable',
});

export const HUB_TIMINGS = {
  // A controller that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before a controller counts as down (scene event).
  downAfterFailures: 2,
  // The firmware queues a command on its next one-second tick: read it back
  // after this (pyopensprinkler found 1 s just enough).
  settleMs: 1_500,
  // A read due at the next start or stop of a station: this long after it,
  // never sooner than the minimum (the firmware opens a station a tick late).
  transitionSlackMs: 2_000,
  transitionMinMs: 2_000,
  // An unchanged value is published again this often, so Gladys never shows
  // it as stale ("no recent value" after 48 h).
  heartbeatMs: 12 * 60 * 60_000,
};

// Bounds of the commands offered to the user (scene actions, widget forms).
export const MAX_RUN_MINUTES = MAX_STATION_SECONDS / 60; // 1080 min = 18 h
export const MAX_RAIN_DELAY_HOURS = 720; // 30 days; the controller takes more
export const DEFAULT_RAIN_DELAY_HOURS = 24;

/** A number typed in a scene or a form: a number, or a string ("10", "2,5"). */
export function parseNumber(raw) {
  if (typeof raw === 'number') {
    return raw;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    return Number(raw.trim().replace(',', '.'));
  }
  return NaN;
}

const signature = (controller) => JSON.stringify([controller.url, controller.password]);

export class OpenSprinklerHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/opensprinkler/http.js)
   * @param {boolean} [options.timers] periodic timers (off in most tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<number, object>} controller records, by slot */
    this.records = new Map();
    this.transports = new Map();
    this.connection = null;
    this.saved = { controllers: {}, counters: {} };
    this.pollTimer = null;
    this.stopped = false;
    this.issues = createIssueLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const object = (value) => (value && typeof value === 'object' ? value : {});
    this.saved = { controllers: object(saved.controllers), counters: object(saved.counters) };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.transports.clear();
    this.connection = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    const wanted = new Map(config.controllers.map((controller) => [controller.slot, controller]));
    for (const [slot, record] of this.records) {
      const controller = wanted.get(slot);
      if (!controller || record.signature !== signature(controller)) {
        this.dropRecord(record);
        this.records.delete(slot);
      }
    }
    for (const controller of config.controllers) {
      const record = this.records.get(controller.slot);
      if (record) {
        record.controller = controller; // a new name: same client
      } else {
        this.records.set(controller.slot, this.newRecord(controller));
      }
    }
    await this.publishDevices();
    await this.pollAll({ force: true });
    this.schedulePoll();
  }

  newRecord(controller) {
    // What the last reading of this slot learned, if it was the same address.
    const saved = this.saved.controllers[controller.slot];
    const known = saved && saved.url === controller.url && saved.platformId ? saved : null;
    return {
      controller,
      signature: signature(controller),
      client: new OpenSprinklerClient({
        url: controller.url,
        password: controller.password,
        request: this.request,
      }),
      platformId: known?.platformId ?? null,
      structure: known?.structure ?? null,
      snapshot: null,
      reachable: null,
      error: null,
      failures: 0,
      down: false,
      downSince: null,
      polledAt: null,
      polling: null,
      retryTimer: null,
      transitionTimer: null,
    };
  }

  dropRecord(record) {
    record.dropped = true;
    clearTimeout(record.retryTimer);
    clearTimeout(record.transitionTimer);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    for (const record of this.records.values()) {
      clearTimeout(record.retryTimer);
      clearTimeout(record.transitionTimer);
    }
    await Promise.all([...this.records.values()].map((record) => record.polling?.catch(() => {})));
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || this.records.size === 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        // Skips a controller read less than half a period ago (by onPoll or a command).
        await this.pollAll({ minGap: 0.5 });
        this.issues.ok('poll', 'Polling works again');
      } catch (err) {
        this.issues.fail('poll', `Polling failed: ${err.message}`);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  label(record) {
    const name = controllerName(record.controller, record.structure);
    return `OpenSprinkler ${record.controller.slot} (${name})`;
  }

  // --- Devices ---------------------------------------------------------------

  async publishDevices() {
    const devices = [...this.records.values()]
      .filter((record) => record.platformId && record.structure)
      .map((record) => buildDevice(this.gladys, record.controller, record, this.config.language));
    // Even an empty list: the Discovery tab then shows no stale controller.
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.issues.ok('devices', 'Devices accepted again');
    } catch (err) {
      this.issues.fail('devices', `Devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the controllers, publish the devices. */
  async rediscover() {
    await this.pollAll({ force: true });
    await this.publishDevices();
  }

  recordOf(externalId) {
    const platformId = platformIdOf(this.gladys, externalId);
    if (!platformId) {
      return null;
    }
    return [...this.records.values()].find((record) => record.platformId === platformId) ?? null;
  }

  /** External id of the device of a record (null before its first reading). */
  deviceId(record) {
    return record.platformId ? deviceIds(this.gladys, record.platformId).device : null;
  }

  isCreated(record) {
    const id = deviceIds(this.gladys, record.platformId).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  /** The user added (or updated) a device: its states sent before were dropped. */
  async onDeviceCreated(device) {
    const record = this.recordOf(device.external_id);
    if (!record) {
      return;
    }
    this.gladys.forgetPublishedStates(device.external_id);
    await this.publishStates(record);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading the controllers -------------------------------------------------

  /**
   * Read every controller (unless read less than `minGap` periods ago).
   * @param {{ force?: boolean, minGap?: number }} [options]
   */
  async pollAll({ force = false, minGap = 0 } = {}) {
    if (this.gladys.connected === false) {
      logger.debug('Gladys unreachable: reading skipped');
      return;
    }
    const records = [...this.records.values()];
    const changes = await Promise.all(
      records.map((record) =>
        this.poll(record, { force, minGap }).catch((err) => {
          this.issues.fail(
            `read-${record.controller.slot}`,
            `${this.label(record)}: ${err.message}`,
          );
          return false;
        }),
      ),
    );
    await this.afterChanges(changes.some(Boolean));
  }

  /** Gladys asks for a refresh (onPoll): read that controller unless the timer just did. */
  async pollDevice(device) {
    const record = this.recordOf(device.external_id);
    if (record) {
      await this.afterChanges(await this.poll(record, { minGap: 0.9 }));
    }
  }

  /**
   * Read one controller and apply what changed. Concurrent calls share the
   * read; a forced one (after a command) waits for it and reads again.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  async poll(record, { force = false, minGap = 0 } = {}) {
    while (force && record.polling) {
      await record.polling.catch(() => {});
    }
    if (record.polling) {
      return record.polling;
    }
    const period = this.config.pollIntervalMs;
    if (!force && record.polledAt !== null && this.now() - record.polledAt < period * minGap) {
      logger.debug(`${this.label(record)}: read ${this.now() - record.polledAt} ms ago, skipped`);
      return false;
    }
    record.polledAt = this.now();
    record.polling = this.read(record).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record) {
    let snapshot;
    try {
      snapshot = parseState(await record.client.readAll(), { flowUnit: this.config.flowUnit });
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
    return this.applySuccess(record, snapshot);
  }

  async applySuccess(record, snapshot) {
    if (record.dropped) {
      return false;
    }
    const widgetBefore = this.widgetSignature(record);
    const lifecycle = record.down
      ? `answers again after ${Math.round((this.now() - record.downSince) / 60_000)} min`
      : record.error
        ? 'connection restored'
        : record.reachable === null
          ? `connected (firmware ${snapshot.firmware ?? 'unknown'})`
          : null;
    record.failures = 0;
    record.downSince = null;
    record.error = null;
    record.reachable = true;

    // Identity and structure: a new controller, a renamed station, a new
    // program or sensor republish the device (Gladys offers "Update").
    const platformId = snapshot.mac ?? `slot${record.controller.slot}`;
    const structure = {
      ...structureOf(snapshot),
      deviceName: snapshot.deviceName,
      firmware: snapshot.firmware,
      hardware: snapshot.hardware,
    };
    const previous = record.platformId === platformId ? record.snapshot : null;
    if (
      record.platformId !== platformId ||
      JSON.stringify(record.structure) !== JSON.stringify(structure)
    ) {
      if (record.platformId && record.platformId !== platformId) {
        logger.info(`${this.label(record)}: another controller answers at this address`);
      }
      record.platformId = platformId;
      record.structure = structure;
      this.saved.controllers[record.controller.slot] = {
        url: record.controller.url,
        platformId,
        structure,
      };
      this.store.save(this.saved);
      await this.publishDevices();
    }

    // Logged once the structure is known: the label carries the controller name.
    if (lifecycle) {
      logger.info(`${this.label(record)}${record.down ? ' ' : ': '}${lifecycle}`);
    }
    record.down = false;

    this.updateCounter(record, snapshot);
    record.snapshot = snapshot;
    if (previous) {
      await this.finishedTransition(record, previous, snapshot);
    }
    await this.publishStates(record);
    this.scheduleTransition(record);
    return widgetBefore !== this.widgetSignature(record);
  }

  /**
   * Seconds until the next change the controller announces: a waiting
   * station due to start, a running one due to stop. Null when nothing is due.
   */
  nextTransition(snapshot) {
    let next = null;
    for (const station of snapshot.stations) {
      let due = null;
      if (station.running && station.remaining > 0) {
        due = station.remaining;
      } else if (station.queued && station.start > 0) {
        due = Math.max(0, station.start - snapshot.deviceTime);
      }
      if (due !== null && (next === null || due < next)) {
        next = due;
      }
    }
    return next;
  }

  /**
   * Read again right after the next start or stop, rather than up to a period
   * later: the switch of a station turned on in Gladys shows it watering a
   * few seconds after the command (the firmware queues it, opens the master,
   * then the station), and the "station finished" event fires on time.
   */
  scheduleTransition(record) {
    clearTimeout(record.transitionTimer);
    record.transitionTimer = null;
    if (!this.timersEnabled || this.stopped || record.dropped) {
      return;
    }
    const due = this.nextTransition(record.snapshot);
    if (due === null || record.snapshot.paused) {
      return;
    }
    const delay = Math.max(
      this.timings.transitionMinMs,
      due * 1000 + this.timings.transitionSlackMs,
    );
    if (delay >= this.config.pollIntervalMs) {
      return; // the regular reading comes first
    }
    record.transitionTimer = setTimeout(() => {
      record.transitionTimer = null;
      this.poll(record, { force: true })
        .then((changed) => this.afterChanges(changed))
        .then(() => this.issues.ok('transition', 'Transition reads work again'))
        .catch((err) => this.issues.fail('transition', `Transition read failed: ${err.message}`));
    }, delay);
    record.transitionTimer.unref?.();
  }

  /** The water meter: the controller counts pulses since power-on only. */
  updateCounter(record, snapshot) {
    const flow = snapshot.flow;
    if (!flow || flow.totalPulses === null) {
      return;
    }
    const counters = this.saved.counters;
    const counter = counters[record.platformId];
    const pulses = flow.totalPulses;
    if (!counter || typeof counter.liters !== 'number' || typeof counter.pulses !== 'number') {
      counters[record.platformId] = { liters: 0, pulses };
    } else if (pulses !== counter.pulses) {
      // Fewer pulses than last time: the controller restarted from 0.
      const added = pulses >= counter.pulses ? pulses - counter.pulses : pulses;
      counter.liters += added * flow.literPerPulse;
      counter.pulses = pulses;
    } else {
      return;
    }
    this.store.save(this.saved);
  }

  /** `lrun` holds the last completed run: a new end time is a station that finished. */
  async finishedTransition(record, previous, next) {
    const run = next.lastRun;
    if (!run || run.end === previous.lastRun?.end || run.station === null) {
      return;
    }
    const station = next.stations[run.station];
    await this.fire(TRIGGERS.STATION_FINISHED, record, {
      station: run.station + 1,
      station_name: station?.name ?? `${run.station + 1}`,
      duration_minutes: Math.round((run.duration / 60) * 10) / 10,
      origin: originOf(run.pid),
    });
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    record.reachable = false;
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`${this.label(record)}: ${err.message}`);
    } else {
      logger.debug(`${this.label(record)}: ${err.message} (again)`);
    }
    // Only silence counts as down: a refused password is a configuration
    // problem, reported by the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      record.failures = 0;
      return wasError !== err.kind;
    }
    record.failures += 1;
    if (record.failures === 1) {
      record.downSince = this.now();
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      if (record.platformId) {
        await this.fire(TRIGGERS.UNREACHABLE, record, {
          error: pick(ERROR_TEXT[err.kind], this.config.language),
        });
      }
    }
    return wasError !== err.kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record, { force: true })
        .then((changed) => this.afterChanges(changed))
        .then(() => this.issues.ok('retry', 'Retry works again'))
        .catch((err) => this.issues.fail('retry', `Retry failed: ${err.message}`));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  async fire(key, record, data) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: deviceIds(this.gladys, record.platformId).device,
        controller: controllerName(record.controller, record.structure),
        ...data,
      });
      this.issues.ok('scene-event', 'Scene events accepted again');
    } catch (err) {
      this.issues.fail('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------

  async publishStates(record) {
    // Gladys drops the states of a device the user did not add: they are
    // sent once it is created (onDeviceCreated).
    if (!record.snapshot || !record.platformId || !this.isCreated(record)) {
      return;
    }
    const counter = this.saved.counters[record.platformId];
    const states = featureStates(this.gladys, record.platformId, record.snapshot, {
      waterCounterLiters: counter?.liters,
    });
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.issues.ok('states', 'States accepted again');
    } catch (err) {
      this.issues.fail('states', `States of ${this.label(record)} refused: ${err.message}`);
    }
  }

  /** What the widget shows of a controller, to know when to nudge it. */
  widgetSignature(record) {
    const s = record.snapshot;
    if (!s || !record.reachable) {
      return JSON.stringify([record.reachable, record.error?.kind]);
    }
    return JSON.stringify([
      s.enabled,
      s.paused,
      s.rainDelay.hours,
      s.stations.map((station) => [station.running, station.queued]),
      s.programs.map((program) => program.enabled),
    ]);
  }

  async afterChanges(widgetChanged) {
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      if (record.reachable === null || !record.platformId) {
        continue;
      }
      const externalId = deviceIds(this.gladys, record.platformId).device;
      const transport = record.reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.issues.ok('transports', 'Transports accepted again');
    } catch (err) {
      this.issues.fail('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name: connected when every controller answers. */
  connectionStatus() {
    const { controllers, invalidSlots } = this.config;
    if (controllers.length === 0) {
      return {
        connected: false,
        message: invalidSlots.length ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noController,
      };
    }
    const failing = [...this.records.values()].filter((record) => record.error);
    if (failing.length === 0 && invalidSlots.length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noController)) {
      const parts = failing.map((record) =>
        labelled(
          controllerName(record.controller, record.structure),
          pick(ERROR_TEXT[record.error.kind], language),
          language,
        ),
      );
      if (invalidSlots.length) {
        parts.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = parts.join(' · ').slice(0, 200);
    }
    // Connected while one controller of several still answers.
    return { connected: failing.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.ok('connection-status', 'Connection status accepted again');
    } catch (err) {
      this.issues.fail('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands ----------------------------------------------------------------

  text(table) {
    return pick(table, this.config?.language);
  }

  /**
   * The controller a command targets: the chosen device, or the only one.
   * @param {string|null|undefined} deviceExternalId
   */
  target(deviceExternalId) {
    if (this.records.size === 0) {
      throw new Error(this.text(ACTION_TEXT.noController));
    }
    let record;
    if (deviceExternalId) {
      record = this.recordOf(deviceExternalId);
    } else if (this.records.size === 1) {
      [record] = this.records.values();
    }
    if (!record) {
      throw new Error(this.text(ACTION_TEXT.unknownController));
    }
    if (!record.snapshot) {
      throw new Error(this.text(ACTION_TEXT.notRead));
    }
    return record;
  }

  /**
   * Send one command, then read the controller back so Gladys shows its
   * real state. A refusal becomes a message in the user's language.
   */
  async command(record, describe, send) {
    try {
      await send(record.client);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      logger.warn(`${this.label(record)}: ${describe} failed: ${err.message}`);
      if (err.kind === ERROR_KINDS.REFUSED) {
        throw new Error(this.text(REFUSAL_TEXT[err.code] ?? REFUSAL_TEXT.other), { cause: err });
      }
      await this.applyFailure(record, err);
      await this.afterChanges(true);
      throw new Error(
        labelled(
          controllerName(record.controller, record.structure),
          this.text(ERROR_TEXT[err.kind]),
          this.config.language,
        ),
        { cause: err },
      );
    }
    logger.info(`${this.label(record)}: ${describe}`);
    await this.settle();
    await this.afterChanges(await this.poll(record, { force: true }));
  }

  settle() {
    if (this.timings.settleMs <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, this.timings.settleMs));
  }

  station(record, number) {
    const index = Math.round(parseNumber(number)) - 1;
    const station = record.snapshot.stations[index];
    if (!station) {
      throw new Error(this.text(ACTION_TEXT.unknownStation));
    }
    return station;
  }

  /** Run station `number` (1-based) for `minutes`. */
  async runStation(deviceExternalId, number, minutes) {
    const record = this.target(deviceExternalId);
    const station = this.station(record, number);
    const duration = parseNumber(minutes);
    if (!Number.isFinite(duration) || duration < 1 || duration > MAX_RUN_MINUTES) {
      throw new Error(this.text(ACTION_TEXT.badMinutes));
    }
    if (station.master) {
      throw new Error(this.text(ACTION_TEXT.masterStation));
    }
    await this.command(
      record,
      `station ${station.index + 1} started for ${Math.round(duration)} min`,
      (client) => client.runStation(station.index, duration * 60),
    );
  }

  /** Stop station `number` (1-based); stopping an idle station is not an error. */
  async stopStation(deviceExternalId, number) {
    const record = this.target(deviceExternalId);
    const station = this.station(record, number);
    await this.command(record, `station ${station.index + 1} stopped`, async (client) => {
      try {
        await client.stopStation(station.index);
      } catch (err) {
        // "Out of range": the station was neither running nor waiting.
        if (err.code !== RESULT.OUT_OF_RANGE) {
          throw err;
        }
      }
    });
  }

  async stopAll(deviceExternalId) {
    const record = this.target(deviceExternalId);
    await this.command(record, 'every station stopped', (client) => client.stopAll());
  }

  /** Start program `number` (1-based) now. */
  async runProgram(deviceExternalId, number, useWeather = true) {
    const record = this.target(deviceExternalId);
    const index = Math.round(parseNumber(number)) - 1;
    const program = record.snapshot.programs[index];
    if (!program) {
      throw new Error(this.text(ACTION_TEXT.unknownProgram));
    }
    await this.command(record, `program ${index + 1} started`, (client) =>
      client.runProgram(index, useWeather !== false),
    );
  }

  async setRainDelay(deviceExternalId, hours) {
    const record = this.target(deviceExternalId);
    const value = parseNumber(hours);
    if (!Number.isFinite(value) || value < 0 || value > MAX_RAIN_DELAY_HOURS) {
      throw new Error(this.text(ACTION_TEXT.badHours));
    }
    const rounded = Math.round(value);
    await this.command(
      record,
      rounded ? `rain delay set to ${rounded} h` : 'rain delay cancelled',
      (client) => client.setRainDelay(rounded),
    );
  }

  async setEnabled(deviceExternalId, enabled) {
    const record = this.target(deviceExternalId);
    await this.command(record, enabled ? 'controller enabled' : 'controller disabled', (client) =>
      client.setEnabled(enabled),
    );
  }

  async setProgramEnabled(deviceExternalId, index, enabled) {
    const record = this.target(deviceExternalId);
    if (!record.snapshot.programs[index]) {
      throw new Error(this.text(ACTION_TEXT.unknownProgram));
    }
    await this.command(
      record,
      `program ${index + 1} ${enabled ? 'enabled' : 'disabled'}`,
      (client) => client.setProgramEnabled(index, enabled),
    );
  }

  /** A switch of a device: the controller, a station, a program. */
  async setValue(device, feature, value) {
    const key = featureKeyOf(this.gladys, feature.external_id);
    const on = Number(value) === 1;
    if (key === 'enabled') {
      return this.setEnabled(device.external_id, on);
    }
    const station = key?.match(/^station_(\d+)$/);
    if (station) {
      const number = Number(station[1]) + 1;
      return on
        ? this.runStation(device.external_id, number, this.config.stationMinutes)
        : this.stopStation(device.external_id, number);
    }
    const program = key?.match(/^program_(\d+)$/);
    if (program) {
      return this.setProgramEnabled(device.external_id, Number(program[1]), on);
    }
    throw new Error(`Feature ${feature.external_id} cannot be controlled`);
  }

  // --- Reports -------------------------------------------------------------------

  /** "Test the connection": read every controller now, one line each. */
  async testConnection() {
    await this.pollAll({ force: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (this.records.size === 0) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const lines = [...this.records.values()].map((record) => {
        const name = controllerName(record.controller, record.structure);
        if (record.error || !record.snapshot) {
          const kind = record.error?.kind ?? ERROR_KINDS.UNREACHABLE;
          return labelled(name, pick(ERROR_TEXT[kind], language), language);
        }
        const s = record.snapshot;
        const parts = [text.ok];
        if (s.firmware) {
          parts.push(text.firmware(s.firmware));
        }
        parts.push(text.counts(s.stations.length, s.programs.length));
        if (!s.enabled) {
          parts.push(text.disabled);
        }
        const watering = s.stations.filter((station) => station.running && !station.master);
        if (watering.length) {
          parts.push(text.watering(watering.length));
        }
        return labelled(name, parts.join(', '), language);
      });
      if (this.config.invalidSlots.length) {
        lines.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /** The controller a widget shows: the chosen one, else the first. */
  view(deviceExternalId) {
    if (deviceExternalId) {
      return this.recordOf(deviceExternalId);
    }
    return [...this.records.values()][0] ?? null;
  }
}
