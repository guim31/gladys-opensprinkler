# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- OpenSprinkler and OpenSprinkler Pi controllers (firmware 2.x) on the local
  network, up to three, each one a Gladys device identified by its MAC
  address.
- Features: controller enabled, one switch per station (waters for the
  configured time, stops), one switch per program (enabled), watering level,
  rain delay, and with the sensors wired: rain sensor, soil sensor, water flow
  and a water meter kept across the controller's reboots.
- Dashboard widget: watering level, rain delay and flow, the stations watering
  with their time left or waiting, and the Water…, Program…, Stop all and
  Rain delay… buttons (Gladys 5.2.0 or later).
- Scene triggers "OpenSprinkler station finished" and "OpenSprinkler
  unreachable"; scene actions to water a station, stop watering, start a
  program and set the rain delay.
- A "Test the connection" button and a connection status naming the problem
  (no answer, password refused, not an OpenSprinkler).
- Every text in English, French, German and Spanish, with the user guide in
  the four languages.

[Unreleased]: https://github.com/guim31/gladys-opensprinkler/commits/main
