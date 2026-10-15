// -----------------------------------------------------------------------------
// The dashboard widget: its content passes the SDK's validator (the core's
// vocabulary and budget) in every state and language, and its buttons drive
// the controller.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ACTIONS, TEXT } from '../src/widgets.js';
import {
  DEFAULT_PASSWORD,
  FakeOpenSprinkler,
  URL_1,
  createWorld,
  deviceId,
  variant,
} from './helpers/world.js';

const IDLE = 'demo-2.2.1/configured-idle.ja.json';

async function world(t, state = IDLE, config = {}) {
  const controller = new FakeOpenSprinkler({ state });
  const w = await createWorld({
    controllers: { [URL_1]: controller },
    config: {
      controller_1_url: URL_1,
      controller_1_password: DEFAULT_PASSWORD,
      language: 'en',
      ...config,
    },
  });
  t.after(() => w.app.stop());
  return { ...w, controller };
}

async function content(w, { settings = {}, language = 'en' } = {}) {
  const ack = await w.fake.widgetGet('controller', { settings, language });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

const of = (c, type) => c.components.filter((component) => component.type === type);

const manyStations = variant(IDLE, (all) => {
  const count = 24;
  all.status.nstations = count;
  all.stations.snames = Array.from({ length: count }, (_, i) => `Zone ${i + 1}`);
  all.status.sn = Array.from({ length: count }, (_, i) => (i < 3 ? 1 : 0));
  all.settings.ps = Array.from({ length: count }, (_, i) =>
    i < 3 ? [99, 300, 0, 0] : i < 15 ? [99, 300, 100 + i, 0] : [0, 0, 0, 0],
  );
  all.options.mas = 0;
});

const states = {
  idle: IDLE,
  manual: 'demo-2.2.1/manual-running.ja.json',
  'program + rain delay': 'demo-2.2.1/program-running-raindelay.ja.json',
  disabled: 'demo-2.2.1/disabled.ja.json',
  '24 stations, 15 busy': manyStations,
};

for (const [label, state] of Object.entries(states)) {
  test(`the content fits the core vocabulary and budget (${label})`, async (t) => {
    const w = await world(t, state);
    for (const language of ['en', 'fr', 'de', 'es']) {
      const c = await content(w, { language });
      assert.deepEqual(validateWidgetContent(c), [], `${label} / ${language}`);
      assert.ok(c.components.length <= 8);
      assert.ok(of(c, 'button').length <= 4);
      const keys = of(c, 'button').map((button) => button.action.key);
      assert.equal(new Set(keys).size, keys.length, 'unique action keys');
      assert.ok(of(c, 'status')[0].items.length <= 10);
    }
  });
}

test('what watering looks like: the time left of each station, the master left out', async (t) => {
  const w = await world(t, 'demo-2.2.1/manual-running.ja.json');
  const c = await content(w);
  const [status] = of(c, 'status');
  assert.deepEqual(
    status.items.map(({ label, value }) => [label, value]),
    [
      ['Controller', 'Watering'],
      ['Rain sensor', 'Rain detected'],
      ['Front lawn', '10 min left'],
      ['Back lawn', '5 min left'],
      ['Unused', '1 min left'],
    ],
  );
  assert.equal(c.ttl_seconds, 30);
  const tiles = of(c, 'value').map(({ label, value, unit }) => [label, value, unit]);
  assert.deepEqual(tiles, [
    ['Watering level', 80, '%'],
    ['Rain delay', 0, 'h'],
    ['Water flow', 0, 'L/min'],
  ]);
});

test('the queue of a program, and the rain delay button turned into "cancel"', async (t) => {
  const w = await world(t, 'demo-2.2.1/program-running-raindelay.ja.json');
  const c = await content(w, { language: 'fr' });
  const [status] = of(c, 'status');
  assert.deepEqual(
    status.items.slice(2).map(({ label, value }) => [label, value]),
    [
      ['Front lawn', 'encore 12 min'],
      ['Back lawn', 'En attente'],
      ['Vegetable garden', 'En attente'],
      ['Drip hedges', 'En attente'],
    ],
  );
  const keys = of(c, 'button').map((button) => button.action.key);
  assert.deepEqual(keys, [
    ACTIONS.RUN_STATION,
    ACTIONS.RUN_PROGRAM,
    ACTIONS.STOP_ALL,
    ACTIONS.CANCEL_RAIN_DELAY,
  ]);
});

test('ten status rows at most: the last one counts the others', async (t) => {
  const w = await world(t, manyStations);
  const [status] = of(await content(w), 'status');
  assert.equal(status.items.length, 10);
  assert.deepEqual(status.items.at(-1).label, 'More stations');
  // The controller and the rain sensor rows, 7 stations, then the count of the 8 others.
  assert.equal(status.items.at(-1).value, 15 - 7);
});

test('the station form lists the stations but the master', async (t) => {
  const w = await world(t, IDLE, { station_minutes: '20' });
  const c = await content(w);
  const button = of(c, 'button').find((b) => b.action.key === ACTIONS.RUN_STATION);
  const [station, minutes] = button.action.fields;
  assert.deepEqual(
    station.options.map((option) => option.value),
    ['1', '2', '3', '4', '5', '6', '7'],
  );
  assert.equal(station.options[2].label.en, '3. Vegetable garden');
  assert.equal(minutes.default, 20);
});

test('the buttons drive the controller, and answer with a toast', async (t) => {
  const w = await world(t);
  const settings = { device: deviceId(w.gladys) };
  let ack = await w.fake.widgetAction(
    'controller',
    ACTIONS.RUN_STATION,
    {},
    {
      settings,
      values: { station: '3', minutes: 12 },
    },
  );
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.en, 'Vegetable garden: watering for 12 min.');
  assert.deepEqual(w.controller.settings.ps[2].slice(0, 2), [99, 720]);

  ack = await w.fake.widgetAction('controller', ACTIONS.STOP_ALL, {}, { settings });
  assert.equal(ack.data.message.fr, 'Toutes les stations sont arrêtées.');
  assert.ok(w.controller.settings.ps.every(([pid]) => pid === 0));

  ack = await w.fake.widgetAction(
    'controller',
    ACTIONS.RUN_PROGRAM,
    {},
    {
      settings: {},
      values: { program: '2', use_weather: false },
    },
  );
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.en, 'Evening drip started.');
  assert.deepEqual(w.controller.requests.find((r) => r.path === '/mp').params, {
    pid: '1',
    uwt: '0',
  });

  ack = await w.fake.widgetAction(
    'controller',
    ACTIONS.RAIN_DELAY,
    {},
    {
      settings,
      values: { hours: 36 },
    },
  );
  assert.equal(ack.data.message.de, 'Bewässerung für 36 h ausgesetzt.');
  assert.equal(w.controller.settings.rd, 1);
  ack = await w.fake.widgetAction('controller', ACTIONS.CANCEL_RAIN_DELAY, {}, { settings });
  assert.equal(ack.success, true);
  assert.equal(w.controller.settings.rd, 0);
});

test('a Gladys older than 5.2.0 sends the tap without the form: asked to update', async (t) => {
  const w = await world(t);
  const ack = await w.fake.widgetAction('controller', ACTIONS.RUN_STATION, {}, { settings: {} });
  assert.equal(ack.success, false);
  assert.equal(ack.error, TEXT.updateGladys.en);
});

test('no controller, an unknown one, one that does not answer', async (t) => {
  const empty = await createWorld({ config: {} });
  t.after(() => empty.app.stop());
  let c = await content(empty);
  assert.equal(c.components[0].text, TEXT.pick.en);

  const w = await world(t);
  c = await content(w, { settings: { device: 'ext:test-integration:controller:0000' } });
  assert.equal(c.components[0].text, TEXT.unknown.en);

  w.controller.online = false;
  await w.hub.pollAll({ force: true });
  c = await content(w);
  assert.deepEqual(validateWidgetContent(c), []);
  assert.equal(of(c, 'status')[0].items[0].value, 'Unreachable');
});
