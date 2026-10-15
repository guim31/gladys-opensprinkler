// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`), registered per key by
// src/app.js. Gladys sends the RESOLVED fields (scene variables substituted,
// defaults applied); throwing fails this action only, the scene continues.
// Keys are permanent once published.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  run_station: (hub, { fields }) => hub.runStation(fields.device, fields.station, fields.minutes),

  stop_watering: (hub, { fields }) => hub.stopAll(fields.device),

  run_program: (hub, { fields }) =>
    hub.runProgram(fields.device, fields.program, fields.use_weather !== false),

  set_rain_delay: (hub, { fields }) => hub.setRainDelay(fields.device, fields.hours),
};
