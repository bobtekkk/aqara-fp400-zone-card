# Changelog

All notable changes to this project are listed here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

To update, get the new card through HACS and copy the new `z2m/aqara-fp400.mjs` into Zigbee2MQTT, then restart Zigbee2MQTT.

## [Unreleased]

## [0.3.0] - 2026-10-02

### Added

- **Turn the map** for a sensor mounted in a corner ([#1](https://github.com/bobtekkk/aqara-fp400-zone-card/issues/1)). Set it in ⚙ Settings (try 45 or -45) and the room looks square on the map. Zones drawn after that follow the room's walls, and areas painted on the turned map cover the cells under the shape. The turn is stored with the sensor, so every dashboard agrees.
- Converter: zones accept a `rotation`, area controls accept a turned shape as `{"points": [[x, y], ...]}`, and the new `map_rotation` setting.

### Changed

- Adding the card from the card picker no longer writes `device:` into its settings. The card finds the FP400 itself, so renaming the sensor later can't break it ([#2](https://github.com/bobtekkk/aqara-fp400-zone-card/issues/2)).

### Fixed

- Zones no longer look deleted while they can't be shown ([#2](https://github.com/bobtekkk/aqara-fp400-zone-card/issues/2)). Instead of an empty room, the card says why: Zigbee2MQTT or the sensor is offline, the zones haven't arrived yet, or the converter is missing.
- A card still set to a sensor's old name now uses the only FP400 in Home Assistant and says which name to put in `device:` ([#2](https://github.com/bobtekkk/aqara-fp400-zone-card/issues/2)).
- When positions are missing, hovering the **Positions unavailable** badge explains what to check.

## [0.2.1] - 2026-10-02

### Fixed

- Zones no longer turn "unknown" when the sensor tracks 3 or more targets on an Ember coordinator (Sonoff ZBDongle-E, SkyConnect). Those coordinators cut the position report at 80 bytes ([zigbee-herdsman#1886](https://github.com/Koenkk/zigbee-herdsman/issues/1886)); the converter now uses every position that arrives. With 3 targets nothing is lost. With 4 or more, a target missing from the report is assumed to stay where it was last seen.
- `target_count` now shows how many targets the sensor reported, even when the report was cut.

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

[Unreleased]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/bobtekkk/aqara-fp400-zone-card/releases/tag/v0.1.0
