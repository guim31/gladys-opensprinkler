# OpenSprinkler fixtures

Answers recorded on **15/10/2026** from the official OpenSprinkler firmware
**2.2.1(6)** (`OpenSprinkler/OpenSprinkler-Firmware`, commit `40894d1`),
compiled on Linux in its **Demo** mode (`make VERSION=DEMO`) and driven through
its HTTP API with the factory password `opendoor`. Two local changes were made
to the build only, never to the answers: the web server listened in IPv4 (the
recording machine had no IPv6), and the Demo build's password bypass was
removed, so that a wrong password answers as on a real controller
(`{"result":2,"item":""}`, and `{"fwv":221}` on `/jo`).

The firmware is GPL-3.0: it was run to record these answers, none of its code
is in this repository. The MAC address `02:FC:00:00:00:01` is the Demo build's
own (locally administered, not a real device); the location is the firmware
default. No real controller, address or name appears here.

Setup before recording (`/cs`, `/co`, `/cp`): eight stations named, station 7
disabled (`d0=64`), station 8 as master (`mas=8`), a flow sensor on input 1
(`sn1t=2`, 2.5 per pulse) and a rain sensor on input 2 (`sn2t=1`, reported
active by the Demo build), watering level 80 %, two programs ("Morning",
enabled; "Evening drip", disabled).

| File                                               | State                                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `demo-2.2.1/configured-idle.ja.json`               | `/ja` of the controller at rest                                                                     |
| `demo-2.2.1/configured-idle.{jc,jo,jn,js,jp}.json` | the same, endpoint by endpoint (firmwares without `/ja`)                                            |
| `demo-2.2.1/manual-running.ja.json`                | stations 1, 2 and 7 started by `/cm` (pid 99), the master engaged                                   |
| `demo-2.2.1/program-running-raindelay.ja.json`     | program 1 started by `/mp` (its stations run as pid 254), a 24 h rain delay, the last run in `lrun` |
| `demo-2.2.1/disabled.ja.json`                      | the controller disabled (`/cv?en=0`)                                                                |
| `demo-2.2.1/paused.jc.json`                        | `/jc` during a 10-minute pause (`/pq?dur=600`): stations stay queued                                |

Observed on that firmware, and relied upon by the code: a station already
running or queued answers `48` to `/cm?en=1`; stopping an idle station
answers `17`; a master station cannot be opened alone (`48`); `/cm` opens a
disabled station; a program started with `/mp` reports its stations with
pid `254`, not its own number; a run is queued on the next one-second tick,
the master opens first and the station a tick later; an unknown page is a
plain-text HTTP 404.

What the Demo build cannot simulate (flow pulses, a soil sensor, the old
single rain sensor fields `urs`/`rs`) is tested on variants of these files
built in the tests themselves (`variant()` in `test/helpers/world.js`).
