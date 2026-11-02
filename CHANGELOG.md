# Changelog

All notable changes to this project are listed here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

To update, get the new card through HACS and copy the new `z2m/aqara-fp400.mjs` into Zigbee2MQTT, then restart Zigbee2MQTT.

## [Unreleased]

## [0.6.0] - 2026-11-02

### Added

- **Native zones**, the sensor's own detection zones (optional). Turn on `native_zones` in the FP400's Zigbee2MQTT device options, then switch the card to **Native zones** and paint them in 0.5 m cells. The sensor works out who is in them itself, so they don't depend on position reports, which Ember coordinators cut short when there are 3 or more targets. Each one gets an occupancy sensor, a people count and its own empty delay, and they stay on the sensor through a power cut. Off by default, so nothing changes unless you turn it on. Thanks to [@makleso6](https://github.com/makleso6) ([#9](https://github.com/bobtekkk/aqara-fp400-zone-card/pull/9)).
- `restore_status` and `restore_error` (off by default) show whether the settings a sensor lost were put back.

### Fixed

- Settings in ⚙ Settings save again after Home Assistant renamed the sensor's entities ([#10](https://github.com/bobtekkk/aqara-fp400-zone-card/pull/10)).
- **Learn the empty room** no longer says it finished as soon as it starts. It now waits for the sensor's answer ([#11](https://github.com/bobtekkk/aqara-fp400-zone-card/pull/11)).
- A zone could empty while a target that dropped out of a cut report might still be in it. Its countdown now stops until every target is accounted for ([#12](https://github.com/bobtekkk/aqara-fp400-zone-card/pull/12)).
- Reports from the sensor's zone endpoints no longer overwrite the room's people count, activity and settings ([#13](https://github.com/bobtekkk/aqara-fp400-zone-card/pull/13)).
- If putting back lost settings only partly works, the converter tries again after 10 s, 30 s, 1 min and 5 min, and a setting you change meanwhile can't be overwritten by it ([#14](https://github.com/bobtekkk/aqara-fp400-zone-card/pull/14)).
- While Zigbee2MQTT was offline, the card told users without admin rights to turn on entities that were already on.

Thanks to [@Mattieug](https://github.com/Mattieug) for #10 to #15.

### Changed

- Much less history in Home Assistant. The four busiest tracking entities (`targets_xy`, `tracking_last_update`, `tracking_last_frame`, `motion_last_frame`) are now off by default on new installs, and the card gets its live dots straight from MQTT instead. That needs a Home Assistant admin user; for anyone else the card names the two entities to turn on. Sensors you already have keep their entities, and the README shows how to keep them out of the history. Thanks to [@monosoul](https://github.com/monosoul) ([#7](https://github.com/bobtekkk/aqara-fp400-zone-card/pull/7)).

## [0.5.0] - 2026-10-29

### Added

- **Forget still dots after** (⚙ Settings, `forget_still_targets`): the sensor is told to forget a target whose dot hasn't moved at all for the minutes you choose, usually a ghost that keeps a zone occupied ([#4](https://github.com/bobtekkk/aqara-fp400-zone-card/issues/4)). A real person is picked up again. It's off (0) until you set it. People asleep can lie that still for over an hour, so use a long time in a bedroom. Thanks to [@satmandu](https://github.com/satmandu) for the idea.
- Firmware updates through Zigbee2MQTT. When Aqara's newer FP400 firmware is in Zigbee2MQTT's update list (0060 is, from September), Zigbee2MQTT shows it as an update you can install from Home Assistant or the **OTA** page. The update takes a while over Zigbee, and the sensor restarts at the end. Thanks to [@lutyjj](https://github.com/lutyjj) ([#8](https://github.com/bobtekkk/aqara-fp400-zone-card/pull/8)).

### Fixed

- Areas and settings survive a power cut. The FP400 forgets its ignore spots, doorways, outside-room areas and mounting (wall or ceiling, wall position, height) when it loses power; a Zigbee2MQTT restart doesn't affect them. The converter now keeps every setting you save with the sensor and puts back whatever the sensor lost when it comes back. Settings made with an older version are taken over from the sensor the first time Zigbee2MQTT starts with this one. An area the sensor changed itself (for example with **Find fake-target spots itself**) is left alone; only an empty one is filled in again. A sensor that already lost them before you update has nothing to take over: after updating, check ⚙ Settings, and if **Mounted on** says unknown, set your mounting and areas once more.
- A native zone's own timeout (`zone_N_absence_timeout`) can be set to 0 seconds, like the room's since 0.4.1.

### Changed

- The sensor can only send updates on its own for five things. The converter used four of them on built-in zone slots that are empty unless you drew zones in the Aqara app. Now they go to room presence, the zones the sensor really has, and then the light level, so on most sensors the light level updates as soon as it changes instead of once a minute. The converter only asks about the rest, once a minute, and checks the light level first. Zigbee2MQTT sets this up once by itself the first time it starts with this version.

## [0.4.1] - 2026-10-05

### Fixed

- The sensor's own **Empty after** time (`absence_timeout`) can now be set to 0 seconds ([#3](https://github.com/bobtekkk/aqara-fp400-zone-card/issues/3)). The sensor reports 10 s as its minimum but stores 0, and the Aqara app allows it too. Thanks to [@satmandu](https://github.com/satmandu) for the report.

## [0.4.0] - 2026-10-04

### Fixed

- Zones no longer flip to "unknown" whenever positions pause ([#2](https://github.com/bobtekkk/aqara-fp400-zone-card/issues/2)). Some sensors only send positions while someone moves. Now, when positions pause, zones follow the sensor's own presence: an empty room empties every zone (with leave events), and while someone is there, zones keep their last state. They are only "unknown" when the sensor has sent neither. `tracking_status` then shows `held`, and the card says **Positions paused**.
- The card finds its entities even after Home Assistant renamed them, for example when you rename the sensor in Home Assistant and let it update entity IDs ([#2](https://github.com/bobtekkk/aqara-fp400-zone-card/issues/2)). It now looks them up by Zigbee2MQTT's fixed unique IDs.
- A movement value other than 1 (moving) or 2 (still) — one sensor sent 11 — now leaves the zone's activity unknown instead of reporting "still". Thanks to [@vize69](https://github.com/vize69) for the report, the analysis and the regression tests.

### Changed

- `tracking_status` has two new values: `partial` (the coordinator cut the last report, so missing targets are kept where they were last seen) and `held` (no new positions; zones follow the sensor's own presence).

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

[Unreleased]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/bobtekkk/aqara-fp400-zone-card/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/bobtekkk/aqara-fp400-zone-card/releases/tag/v0.1.0
