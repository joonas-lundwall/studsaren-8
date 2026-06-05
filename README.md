# studsaren-8

Home automation app for Studsaren 8. Currently built for thermometers... in theory :smoking:

At the moment as a self-hosted dashboard for Aqara T1 Zigbee thermometers, running on a Raspberry
Pi via Docker Compose and displayed on a wall tablet.

## Architecture

```
Aqara T1 → USB dongle → zigbee2mqtt → mosquitto → dashboard (Node) → tablet
```

| Service       | Role                                                |
| ------------- | --------------------------------------------------- |
| `zigbee2mqtt` | Talks to the USB dongle, decodes Zigbee → MQTT JSON |
| `mosquitto`   | MQTT broker                                         |
| `dashboard`   | Node + Express, SSE live updates, SQLite history    |

## Setup (on the Raspberry Pi)

1. **Find the dongle's stable device path:**

   ```sh
   ls -l /dev/serial/by-id/
   ```

   Put that `/dev/serial/by-id/usb-...` path into both `docker-compose.yaml`
   (the `devices:` line) and `zigbee2mqtt/configuration.yaml` (`serial.port`).
   It survives reboots, unlike `/dev/ttyACM0`.

2. **Start everything:**

   ```sh
   docker compose up -d
   ```

3. **Pair the sensors:** open `http://<pi-ip>:8080` (the Z2M frontend), click
   **Permit join**, then press the pairing button on each Aqara T1 until it
   appears. Give each a friendly name (e.g. `bedroom`). Turn Permit join back
   off when done.

4. **Open the dashboard:** `http://<pi-ip>:3000`. On the tablet, open the same
   URL in fullscreen/kiosk mode. Tap a card to see its last 24h chart.

## API

| Endpoint                          | Description                          |
| --------------------------------- | ------------------------------------ |
| `GET /api/state`                  | Latest reading for every sensor      |
| `GET /api/sensors/:name`          | Latest reading for one sensor        |
| `GET /api/sensors/:name/history?hours=24` | Historical readings (max 90 days) |
| `GET /api/health`                 | Broker connection + sensor count     |
| `GET /events`                     | Server-Sent Events live stream       |

## Data & retention

- History is stored in SQLite at `dashboard/data/readings.db` (Docker volume),
  so it survives container rebuilds. Don't delete that folder.
- Readings older than `RETENTION_DAYS` (default 90, set in `docker-compose.yaml`)
  are pruned automatically.

## Notes

- Mosquitto runs with anonymous access — fine on a trusted home LAN; lock it
  down if you expose it.
- If an Aqara T1 keeps dropping off, re-pair it close to the dongle.
  test
