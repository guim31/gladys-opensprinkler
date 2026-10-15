# OpenSprinkler for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows and controls [OpenSprinkler](https://opensprinkler.com) and
OpenSprinkler Pi irrigation controllers through their local HTTP API (firmware
2.x), over the local network. No cloud, no account.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against the OpenSprinkler API reference and against answers
> recorded on the official firmware 2.2.1(6) built in its Demo mode, not
> against a physical controller. Please report what works and what does not in
> the [issues](https://github.com/guim31/gladys-opensprinkler/issues).

This project is not affiliated with OpenSprinkler or OpenThings Inc.
"OpenSprinkler" is a name of its owners, used here to say what the
integration talks to.

## Features

- **One device per controller** (up to three, identified by their MAC
  address): the **controller enabled** switch, **one switch per station**
  (on while it waters; turning it on waters it for the configured time, 10
  minutes by default; off stops it), **one switch per program** (enabled or
  not), the **watering level** (%), the **rain delay** (hours left), and,
  when wired, the **rain sensor**, the **soil sensor**, the **water flow**
  (m³/h) and a **water meter** (liters, kept across the controller's reboots).
- **Dashboard widget** "OpenSprinkler": the watering level, rain delay and
  flow tiles, the controller state, each station watering with its time left
  or waiting in the queue, and four buttons: **Water…** (station and duration
  in a form), **Program…**, **Stop all** (with confirmation) and **Rain
  delay…** / **Cancel rain delay**.
- **Scene triggers**: _OpenSprinkler station finished_ (with the station, how
  long it watered, and what started it) and _OpenSprinkler unreachable_.
- **Scene actions**: _Water an OpenSprinkler station_, _Stop OpenSprinkler
  watering_, _Start an OpenSprinkler program_, _Set the OpenSprinkler rain
  delay_.
- A **Test the connection** button, a connection status naming the controller
  and the problem, a **transport badge** per device (local or unreachable).
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.2.0** or later (the widget buttons open forms).
- An OpenSprinkler (hardware 2.x, 3.x, 4.x) or OpenSprinkler Pi with a
  **2.x firmware**; 2.1.9 or later recommended. Firmwares older than 2.1.6
  (no `/ja` endpoint) are read endpoint by endpoint.
- The **device password** of the controller (the one of the OpenSprinkler
  app; factory default `opendoor`).

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-opensprinkler`
   (or install **OpenSprinkler** from the catalog once it is listed).
2. In **Configuration**, enter the address of the controller
   (`192.168.1.20`, `sprinkler.local:8080`…) and its device password; up to
   two more controllers below. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the device.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- Every call is a `GET` with the lowercase MD5 hash of the device password in
  `pw`, as the official app does. Every 30 s or 1 min (configurable), each
  controller is read with one `GET /ja` (settings, options, stations, status,
  programs); a firmware without `/ja` is read with `/jc`, `/jo`, `/jn`, `/js`
  and `/jp`, one after the other. Requests to a controller are never sent in
  parallel: the ESP8266 web server serves one client at a time.
- Commands: `/cm` (run or stop a station), `/cv` (stop all, enable, rain
  delay), `/mp` (start a program), `/cp` (enable a program). The controller
  is read back right after each one, so Gladys shows its real state.
- The devices are published with `should_poll: true` and a one-minute
  `poll_frequency`, but Gladys does not poll external devices reliably
  (GladysAssistant/Gladys#3198): the container reads the controllers on its
  own timer; the core's `onPoll` is a fallback that skips a controller read
  less than 90 % of a period ago.
- Only the values that changed are sent to Gladys (the SDK's
  `publishChangedStates`), every value again every 12 hours (heartbeat), and
  all of them when a device is added or Gladys reconnects.
- The "station finished" trigger follows `lrun`, the last completed run the
  controller reports. A controller is "unreachable" after two failed reads in
  a row (the second one 15 s after the first); a refused password is a
  configuration problem, shown in the connection status.
- `/data/opensprinkler-state.json` keeps the identity and structure of each
  controller (so its device is published while it is offline) and the water
  meter totals. Passwords stay in the Gladys configuration and never reach the
  logs.

## Checked, and what was not

The tests run against an in-memory controller built from answers recorded on
the official firmware 2.2.1(6) (`test/fixtures/opensprinkler/`), compiled in
its Demo mode on Linux and driven through its HTTP API, plus variants for what
the Demo build cannot simulate (flow pulses, a soil sensor, the old
single-sensor fields). Not checked on real hardware: the flow and soil sensors,
an OpenSprinkler Pi, a firmware older than 2.2.1, the load on an ESP8266
controller. `scripts/probe.mjs <address>` reads a real controller without
changing anything and prints what the integration would see, without the
password, the MAC address or the station names:

```bash
OS_PASSWORD='your device password' node scripts/probe.mjs 192.168.1.20
```

## Limits

- Stations and programs are identified by their index on the controller, the
  only identifier the API gives: deleting or reordering programs shifts the
  program switches.
- A program started by hand runs as a "run-once" program on the controller.
- When two stations finish between two readings, the "station finished"
  trigger reports the last one only.
- Expanded sensors, special stations and program editing are left to the
  OpenSprinkler app.
- HTTP only, as on the controller itself: the password hash travels
  unencrypted on the local network.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store .   # store checks
```

Project rules: [`CLAUDE.md`](CLAUDE.md). Changes: [`CHANGELOG.md`](CHANGELOG.md).

## Credits

- [OpenSprinkler](https://github.com/OpenSprinkler/OpenSprinkler-Firmware)
  (Ray Wang and contributors) for the firmware and its API reference. The
  firmware is GPL-3.0: it was read and run to record its answers, none of its
  code is copied here.
- [hass-opensprinkler](https://github.com/vinteo/hass-opensprinkler) and
  [py-opensprinkler](https://github.com/vinteo/py-opensprinkler) by Vincent
  Teo and contributors (MIT), the Home Assistant integration and its library,
  for the reading of the API (password hash, `/ja` fallback, flow rate,
  station status).
- Built from the
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## License

[Apache-2.0](LICENSE).
