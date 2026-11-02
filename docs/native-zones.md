# FP400 native zones and reports

The external converter supports `lumi.models.4447_8295`. Native zones are separate from the existing software zones: the FP400 computes native occupancy and people counts, while Zigbee2MQTT computes software zones from coordinates. Enable the `native_zones` device option in Zigbee2MQTT to expose the native editor's 40 entities; the option is off by default.

## Native zone transport

All zone commands go to endpoint 1, cluster `0xFC0A`, manufacturer `0x115F`.

| Operation | Command | Response |
| --- | --- | --- |
| Append one zone | `0x04` | `0x05` |
| Update one zone | `0x06` | `0x07` |
| Remove one zone | `0x08` | `0x09` |

Append/Update carry a STRUCT with four typed members: zone ID (uint8), zone type (enum8, 0 for detection), a 40-byte OCTET_STR bitmap, and proximity enabled (boolean, true). The STRUCT parameter begins with its member count; there is no extra outer `0x4C` tag. A complete Append/Update ZCL frame is 55 bytes.

The matching native response must contain `errorCode=0`. A generic Default Response SUCCESS is not the native command response. The converter uses herdsman's existing response matching and timeout, checks the returned error code, and confirms the endpoint map. A newly appended zone remains `pending` while the sensor initializes its endpoint. The existing 10-second poll completes it no earlier than 20 seconds after acknowledgement, restores any saved numeric timeout, reads it back, and only then publishes `ready`. This delay accommodates the delayed reset observed on firmware 20260724; there is no documented initialization-complete event. Existing-zone updates and removals do not need this creation delay.

Each mask is 20 rows × 16 columns of 50 cm cells. Bit `row * 16 + column` is MSB-first within its byte. Rows run from y=0 to 1000 cm; columns run from x=+400 towards −400 cm. A set bit includes the cell in a native detection zone. Holes and disconnected cells remain part of the original bitmap representation.

The active endpoint map comes from endpoint 1 / `0xFC0B` / `0x0000` (ChildEndpointList), followed by `0xFC0B` / `0x0001` (ZoneID) on each returned endpoint. The endpoint number is not calculated from the zone ID. The map is refreshed at startup (after custom clusters are registered), on configure, after zone writes, on `deviceAnnounce`, and when native zones are enabled. Routine one-minute telemetry polling reuses the map. A failed refresh retains the last complete map and readings; the existing poll retries failed refreshes.

The card manages IDs 1–8 one at a time. It does not clear the full catalogue. IDs created by another controller remain untouched unless the user explicitly selects and replaces or deletes that ID.

## Configuration and confirmation

`native_zone_N_config` accepts JSON with `name` and `mask_hex` (80 hex characters). The sole timeout setting is `zone_N_absence_timeout` (seconds); `absence_timeout` in the geometry JSON is rejected. Save a new zone first, then change its timeout in the card or the existing number entity. Timeout changes apply immediately and are confirmed by readback; they do not rewrite geometry. While a zone is initializing, timeout writes are blocked. Old stored geometry is published without its former timeout field; the number entity reports the sensor's actual value. `clear` removes a known zone. Taking over an existing ID that is not owned by this converter requires `overwrite:true`; deletion uses `{"clear":true,"overwrite":true}`. The converter permits retrying an owned interrupted write; the card additionally asks for confirmation whenever the published geometry is uncertain.

Published configurations have three forms:

- JSON: geometry last successfully written by this converter and saved in Zigbee2MQTT's device database.
- `clear`: no active hardware zone at this ID.
- `unmanaged`: geometry is unknown or uncertain, including a previously saved zone that is now absent from the hardware map. The card asks for explicit confirmation before taking over such a slot.

`native_zone_N_status` reports `pending`, `ready`, or `error`; `native_zone_N_error` carries the failure reason. A Home Assistant service return only acknowledges submission. The card waits for the converter's confirmed configuration and status.

The converter saves an operation as pending before sending it. A failure after a command may leave the physical device changed; it does not automatically undo the command. A later attempt reads the current endpoint map again. An interrupted pending operation becomes a retryable error after restart. Uncertain geometry is not displayed as confirmed; keep an open draft to retry it. Native geometry is not automatically restored after a sensor reset or power loss.

Each command must fit Home Assistant MQTT Text's [255-character limit](https://www.home-assistant.io/integrations/text.mqtt/), including JSON escaping and the overwrite flag. Zone names are local labels; they are not part of the Zigbee payload.

The geometry is a local record of acknowledged writes, not a fresh read of the sensor's full catalogue. Changes made by another controller to an existing ID's geometry cannot be detected from ChildEndpointList/ZoneID alone.

## Pairing capture (not applied by this converter)

The M3/Homey research observed a write to endpoint 1 / `0xFCC0` / `0x00A0`, uint8=1, manufacturer `0x115F`:

```text
04 5f 11 <TSN> 02 a0 00 20 01
```

This converter does not send that write on interview, re-interview, startup, announce, or configure. Its effect needs a separate Zigbee2MQTT experiment before it can be considered for inclusion.

Evidence from 28 October 2026:

- Aqara M3 pairing, frame 614: `045f117902a0002001`; frame 616: Write Attributes SUCCESS.
- Homey pairing reproduction, frame 9588: `045f111502a0002001`; frame 9596: SUCCESS.
- After the Homey write, unsolicited Report Attributes frames reported room count 2, zone count 1, then room count 2→1 and zone count 1→0.

This establishes the observed initialization sequence and subsequent reports. The internal meaning of `0x00A0` is not documented; it should not be named as a proven "enable reports" bit. The capture does not establish a need to repeat it on every restart.

## AttributeSync reports

The FP400 also sends manufacturer-specific global command `0x8A`, with attribute-record payloads. The converter validates complete supported scalar records, then delegates them to its ordinary attribute-report converters. It preserves endpoint identity, so a child endpoint's count cannot replace the room count.

Captured examples:

| Endpoint / cluster | Exact ZCL | Meaning |
| --- | --- | --- |
| 1 / `0x0406` | `1c5f117b8a00001801` | Room occupied |
| 1 / `0xFC0B` | `1c5f117d8a0200210100` | Room count 1 |
| 3 / `0xFC0B` | `1c5f113f8a0200210000` | Child endpoint count 0 |
| 2 / `0x0400` | `1c5f11248a0000210931` | Raw illuminance 12553 |
| 1 / `0xFC0C` | `1c5f11008a07003002` | Activity state 2 |

These examples come from passive M3 captures on 22 October 2026. Malformed, truncated, wrong-manufacturer, and unsupported records must not publish partial state.

## APS fragmentation

[zigbee-herdsman#1886](https://github.com/Koenkk/zigbee-herdsman/issues/1886) documents Ember delivering only the first 80-byte block of fragmented FP400 tracking messages. [Homey SDK#481](https://github.com/athombv/homey-apps-sdk-issues/issues/481) independently documents a truncated multi-zone catalogue response on Homey.

This converter does not implement APS reassembly. Per-zone writes and the small ChildEndpointList/ZoneID reads avoid needing the full catalogue to edit known zones. Native occupancy/count reports are independent of coordinate tracking; the live positions and software zones retain their existing limitations.

The wire fixtures and automated tests validate encoding, decoding, confirmation, and editor behavior. In the [maintainer's hardware test](https://github.com/bobtekkk/aqara-fp400-zone-card/pull/9#issuecomment-6518505017) on 30 October 2026, firmware 20260724 with Zigbee2MQTT 2.14.2 confirmed Append/Update/Remove responses, exact masks, endpoint discovery, reporting allocation, and the dashboard editor. The same test found that a new zone resets its timeout to 10 seconds within about 10 seconds of creation. The revised settling and timeout flow has a regression test for that sequence and still needs to be repeated on the physical sensor. Native-zone persistence across power cuts remains unconfirmed; this converter does not recreate lost native geometry.
