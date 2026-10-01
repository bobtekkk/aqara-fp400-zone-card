# Changelog

All notable changes to this project are listed here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

To update, get the new card through HACS and copy the new `z2m/aqara-fp400.mjs` into Zigbee2MQTT, then restart Zigbee2MQTT.

## [Unreleased]

## [0.2.0] - 2026-10-01

### Added

- **Areas** tool with three kinds of area, stored on the sensor like the Aqara app does:
  - **Ignore spot**: fake targets from a fan, a curtain or a TV.
  - **Doorway**: where people come and go.
  - **Outside room**: behind a wall or a window.
- Areas can be painted and erased. **Clear all** works per area type and can be undone. The map shows what Save will change.
- Click a target dot to make the sensor forget it (**Forget this target**), or to turn its spot into an ignore spot (**Ignore this spot**).
- **Settings** panel: sensitivity, empty delay, approach distance, movement events, AI features, mounting, room learning, and re-reading settings from the sensor. Each change waits for the sensor to confirm it.
- Each zone has a people count and a moving/still sensor (`software_zone_N_count`, `software_zone_N_activity`). The zone list shows them.
- Events for automations: `software_zone_N_enter` and `software_zone_N_leave`, and the sensor's own `enter`, `leave`, `approach`, `away`, `left_in`, `left_out`, `right_in` and `right_out`.
- Converter: `entry_exit_*` and `edge_*` area controls next to the `interference_*` ones, and `remove_target`.
- Converter: reads the area masks at start and every 5 minutes, so the card also shows changes made elsewhere.

### Changed

- **Block area** is now **Areas**, and **Save blocks** is now **Save areas**.
- Zone sensors named by the card ("Desk occupancy") now include the new count and activity sensors ("Desk people", "Desk activity"). Zones saved earlier get these names when the card loads.
- The card no longer renames a zone sensor that you renamed by hand.
- Deleting a zone gives its sensors their default names back.
- Live zone status updates in place, so clicks on the zone list are never lost while data streams in.

## [0.1.0] - 2026-10-01

### Added

- First public release.
- Dashboard card: draw up to 8 presence zones on a live map with rulers, pan, zoom and grid snap. Each zone becomes its own occupancy sensor, named after the zone. Nothing changes until you press Save.
- Interference blocks, written to the sensor's own interference area.
- Zigbee2MQTT converter (`z2m/aqara-fp400.mjs`): software zones, interference blocks, position tracking and the sensor's settings.

[Unreleased]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/bobtekkk/aqara-fp400-zone-card/releases/tag/v0.1.0
