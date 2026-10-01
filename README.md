# Aqara FP400 Zone Card

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories/)
[![Validate](https://github.com/bobtekkk/aqara-fp400-zone-card/actions/workflows/validate.yml/badge.svg)](https://github.com/bobtekkk/aqara-fp400-zone-card/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Draw presence zones and block "ghost" spots for the **Aqara FP400** spatial sensor on **Zigbee2MQTT**, straight from a Home Assistant dashboard.

![The card: a live room map with two zones, a tracked person and a blocked interference area](docs/screenshot.png)

- **Up to 8 zones.** Draw rectangles on a live map; each one becomes its own occupancy sensor in Home Assistant.
- **Interference blocks.** Mark spots that cause fake targets (curtain, fan, TV). They are written to the sensor's own interference area, like the Aqara app does.
- **Live map.** See tracked people move, with metre rulers. Pan, zoom and snap to a 0.5 m or 0.1 m grid.
- **Safe editing.** Nothing changes until you press Save, and the card only says "Saved" once the change is confirmed.

**No Matter or Thread hardware needed.** Everything runs over Zigbee, on the Zigbee coordinator you already use with Zigbee2MQTT. No Thread border router, no Matter controller, no Aqara hub.

> Already using the FP400 over Matter instead? See [RAR/ha-aqara-fp400](https://github.com/RAR/ha-aqara-fp400).

## How it fits together

| Part | What it does | How you install it |
|---|---|---|
| `z2m/aqara-fp400.mjs` | Zigbee2MQTT converter: reads the FP400's position reports, runs the zones, writes blocks to the sensor | Copy one file (HACS cannot install Zigbee2MQTT converters) |
| `fp400-zone-card.js` | The dashboard editor | HACS |

## Requirements

- An Aqara FP400 paired to **Zigbee2MQTT 2.x** (tested with 2.14.1) through your existing Zigbee coordinator. No Thread or Matter hardware.
- Home Assistant with the MQTT integration and [HACS](https://hacs.xyz)

## Install

### 1. Converter (Zigbee2MQTT)

1. Download [`z2m/aqara-fp400.mjs`](z2m/aqara-fp400.mjs).
2. Put it in the `external_converters` folder next to Zigbee2MQTT's `configuration.yaml` (create the folder if it does not exist).
   With the Home Assistant add-on that is the add-on's data folder, by default `/config/zigbee2mqtt/external_converters/`.
3. Restart Zigbee2MQTT.
4. Check that Home Assistant now has entities like `text.<your_fp400>_software_zone_1_config`.

Use only one FP400 converter at a time. If Zigbee2MQTT later supports the FP400 natively, this file still takes priority until you remove it.

### 2. Card (HACS)

1. In HACS, open the ⋮ menu → **Custom repositories**, add `https://github.com/bobtekkk/aqara-fp400-zone-card` with type **Dashboard**.
2. Search for **Aqara FP400 Zone Card** in HACS and download it.
3. Reload your browser.

<details>
<summary>Without HACS</summary>

Copy `dist/fp400-zone-card.js` to `/config/www/`, then add `/local/fp400-zone-card.js` as a **JavaScript module** under Settings → Dashboards → ⋮ → Resources.
</details>

## Add it to a dashboard

The editor needs room, so give it a view of its own:

1. Edit your dashboard and add a view with view type **Panel (single card)**.
2. Add a card and search for **Aqara FP400 Zone Card**. It finds your FP400 by itself.

Or in YAML:

```yaml
type: custom:fp400-zone-card
device: living_room_fp400 # optional
```

`device` is the start of your FP400's entity IDs, the part before `_software_zone_1_config`. You only need it when you have more than one FP400.

## Using it

- **Draw zone**: drag on the map, name it in the sidebar, press **Save zones**.
- **Block area**: drag over a spot that shows fake targets, press **Save blocks**. Click a dashed block to remove it. **Cancel block** (or Esc) drops all unsaved blocks. **Clear all blocks** also waits for Save and can be undone.
- Drag empty space to pan, use the mouse wheel to zoom, drag a zone to move it and its corners to resize it. Arrow keys nudge the selected zone.
- **Discard** throws away everything you have not saved.

Each zone gives you:

| Entity | Meaning |
|---|---|
| `binary_sensor.<fp400>_software_zone_N_occupancy` | Someone is in zone N. Unknown while position data is missing or stale. |
| `binary_sensor.<fp400>_software_zone_N_available` | Zone N has fresh, complete position data. |
| `text.<fp400>_software_zone_N_config` | The zone rectangle as JSON (what the card edits). |

If you are an admin, the card also names these after your zone, for example "Desk occupancy".

## Good to know

- Positions are in centimetres from the sensor: x is left/right, y is the distance in front of it. Walk along a new zone's edges once to check it.
- Zones are computed in Zigbee2MQTT from the sensor's position reports. They are saved in Zigbee2MQTT's device database and survive restarts.
- Blocks are 0.5 m cells written to the sensor's own interference area. Their left/right orientation follows the check against the device made by [RAR/ha-aqara-fp400](https://github.com/RAR/ha-aqara-fp400). If a block does not hide a ghost, please open an issue.
- Ember (EZSP) coordinators may cut long reports with several people in them; Z-Stack coordinators are not affected.
- The converter also exposes the sensor's other settings: sensitivity, absence timeout, mounting, AI options, detection depth and spatial learning.

## Development

```sh
npm ci --ignore-scripts
npm test      # unit tests
npm run e2e   # drives the card in a browser with real mouse input
```

`npm run e2e` needs Playwright's Chromium once: `npx playwright-core install chromium`. `test/preview.html` runs the card against a simulated sensor; serve the repository folder with any static web server to try it.

## Credits

- The converter builds on the community FP400 converter by **jcastro** in [Zigbee2MQTT issue #33146](https://github.com/Koenkk/zigbee2mqtt/issues/33146).
- Grid orientation from [RAR/ha-aqara-fp400](https://github.com/RAR/ha-aqara-fp400).
- Not affiliated with Aqara.

## License

[MIT](LICENSE)
