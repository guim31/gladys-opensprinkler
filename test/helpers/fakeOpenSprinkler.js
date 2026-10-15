// -----------------------------------------------------------------------------
// An in-memory OpenSprinkler controller, started from the answers recorded on
// the firmware itself (test/fixtures/opensprinkler/), answering like firmware
// 2.2.1(6): `{"result":2,"item":""}` for a wrong password, `{"fwv":221}` on
// /jo, `48` for a station already running, `17` for an out-of-range value,
// a plain-text 404 for an unknown page.
//
// `handle(url)` is the HTTP seam of the client (src/opensprinkler/http.js);
// `listen()` serves the same controller on 127.0.0.1 for the end-to-end test.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { md5 } from '../../src/opensprinkler/client.js';

export const DEFAULT_PASSWORD = 'opendoor'; // the factory default of every OpenSprinkler

/** A recorded answer (`demo-2.2.1/manual-running.ja.json`). */
export function fixture(name) {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/opensprinkler/${name}`, import.meta.url), 'utf8'),
  );
}

const PID_MANUAL = 99;
const PID_RUN_ONCE = 254;

export class FakeOpenSprinkler {
  /**
   * @param {object} [options]
   * @param {string} [options.state] fixture of the /ja answer
   * @param {string} [options.password]
   * @param {boolean} [options.legacy] an old firmware without /ja
   */
  constructor({
    state = 'demo-2.2.1/configured-idle.ja.json',
    password = DEFAULT_PASSWORD,
    legacy = false,
  } = {}) {
    this.all = typeof state === 'string' ? fixture(state) : structuredClone(state);
    this.hash = md5(password);
    this.legacy = legacy;
    this.online = true;
    /** Every request, without the password: `{ path, params }`. */
    this.requests = [];
  }

  get settings() {
    return this.all.settings;
  }

  get options() {
    return this.all.options;
  }

  json(data) {
    return { status: 200, body: JSON.stringify(data) };
  }

  result(code) {
    return this.json({ result: code, item: '' });
  }

  /** The HTTP seam: `(url) => { status, body }`. */
  async handle(url) {
    if (!this.online) {
      const error = new Error('connect EHOSTUNREACH');
      error.code = 'EHOSTUNREACH';
      throw error;
    }
    const target = new URL(url);
    const path = target.pathname;
    const params = Object.fromEntries(target.searchParams);
    const { pw, ...rest } = params;
    this.requests.push({ path, params: rest });

    const known = ['/jc', '/jo', '/jn', '/js', '/jp', '/cm', '/cv', '/mp', '/cp'];
    if (!this.legacy) {
      known.push('/ja');
    }
    if (!known.includes(path)) {
      return { status: 404, body: 'The requested page does not exist' };
    }
    if (pw !== this.hash && this.options.ipas !== 1) {
      return path === '/jo' ? this.json({ fwv: this.options.fwv }) : this.result(2);
    }
    switch (path) {
      case '/ja':
        return this.json(this.all);
      case '/jc':
        return this.json(this.all.settings);
      case '/jo':
        return this.json(this.all.options);
      case '/jn':
        return this.json(this.all.stations);
      case '/js':
        return this.json(this.all.status);
      case '/jp':
        return this.json(this.all.programs);
      case '/cm':
        return this.manualRun(rest);
      case '/cv':
        return this.changeVariables(rest);
      case '/mp':
        return this.manualProgram(rest);
      case '/cp':
        return this.changeProgram(rest);
      default:
        return this.result(32);
    }
  }

  isMaster(index) {
    return ['mas', 'mas2', 'mas3', 'mas4'].some((key) => this.options[key] === index + 1);
  }

  setStation(index, entry, on) {
    this.settings.ps[index] = entry;
    this.all.status.sn[index] = on ? 1 : 0;
    const bank = Math.floor(index / 8);
    const bit = 1 << (index % 8);
    this.settings.sbits[bank] = on
      ? this.settings.sbits[bank] | bit
      : this.settings.sbits[bank] & ~bit;
    this.settings.nq = this.settings.ps.filter(([pid]) => pid > 0).length;
  }

  finish(index) {
    const [pid, , start] = this.settings.ps[index];
    this.settings.lrun = [index, pid, Math.max(0, this.settings.devt - start), this.settings.devt];
    this.setStation(index, [0, 0, 0, 0], false);
  }

  manualRun({ sid, en, t }) {
    const index = Number(sid);
    if (!Number.isInteger(index) || index < 0 || index >= this.all.status.nstations) {
      return this.result(17);
    }
    const [pid] = this.settings.ps[index];
    if (en === '1') {
      const seconds = Number(t);
      if (!(seconds >= 1 && seconds <= 64_800)) {
        return this.result(17);
      }
      if (pid !== 0 || this.isMaster(index)) {
        return this.result(48);
      }
      this.setStation(index, [PID_MANUAL, seconds, this.settings.devt, 0], true);
      return this.result(1);
    }
    if (pid === 0) {
      return this.result(17);
    }
    this.finish(index);
    return this.result(1);
  }

  changeVariables({ rsn, en, rd }) {
    if (rsn === '1') {
      this.settings.ps.forEach(([pid], index) => {
        if (pid !== 0) {
          this.setStation(index, [0, 0, 0, 0], false);
        }
      });
    }
    if (en !== undefined) {
      this.settings.en = Number(en) ? 1 : 0;
      this.options.den = this.settings.en;
    }
    if (rd !== undefined) {
      const hours = Number(rd);
      this.settings.rd = hours > 0 ? 1 : 0;
      this.settings.rdst = hours > 0 ? this.settings.devt + hours * 3600 : 0;
    }
    return this.result(1);
  }

  manualProgram({ pid, uwt }) {
    const index = Number(pid);
    const program = this.all.programs.pd[index];
    if (!program) {
      return this.result(17);
    }
    this.changeVariables({ rsn: '1' });
    const level = uwt === '1' ? this.options.wl : 100;
    let start = this.settings.devt;
    program[4].forEach((duration, station) => {
      const seconds = Math.round((duration * level) / 100);
      if (seconds > 0 && !this.isMaster(station)) {
        this.setStation(station, [PID_RUN_ONCE, seconds, start, 0], start === this.settings.devt);
        start += seconds;
      }
    });
    return this.result(1);
  }

  changeProgram({ pid, en }) {
    const program = this.all.programs.pd[Number(pid)];
    if (!program) {
      return this.result(17);
    }
    if (en !== undefined) {
      program[0] = Number(en) ? program[0] | 1 : program[0] & ~1;
    }
    return this.result(1);
  }

  /** Let `seconds` pass on the controller: runs count down and finish. */
  advance(seconds) {
    this.settings.devt += seconds;
    this.settings.ps.forEach(([pid, remaining], index) => {
      if (pid !== 0 && this.all.status.sn[index] === 1) {
        if (remaining <= seconds) {
          this.finish(index);
        } else {
          this.settings.ps[index][1] = remaining - seconds;
        }
      }
    });
  }

  /** Serve this controller on 127.0.0.1 (end-to-end test). */
  async listen() {
    this.server = createServer(async (request, response) => {
      try {
        const { status, body } = await this.handle(`http://127.0.0.1${request.url}`);
        response.writeHead(status, {
          'content-type': status === 200 ? 'application/json' : 'text/html',
        });
        response.end(body);
      } catch {
        request.socket.destroy();
      }
    });
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${this.server.address().port}`;
  }

  close() {
    return new Promise((resolve) => (this.server ? this.server.close(resolve) : resolve()));
  }
}

/** A fake network of controllers, by base URL: the client's HTTP seam. */
export function createNetwork(controllers) {
  return {
    controllers,
    async request(url) {
      const origin = new URL(url).origin;
      const controller = controllers[origin];
      if (!controller) {
        const error = new Error('connect ETIMEDOUT');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      return controller.handle(url);
    },
  };
}
