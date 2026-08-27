# Trishuli event evidence

This directory builds the machine-readable evidence used by the public
[Trishuli evidence brief](https://climascope.hutton.ac.uk/trishuli/report).
It is deliberately separate from the pre-event exposure inventory.

Run from the ClimaScope application directory:

```bash
python analysis/trishuli/build_event_evidence.py
```

The script retrieves the reviewed USGS event record and 26 August 2026 point
observations from five Nepal DHM station pages, then samples source and border
elevations from Copernicus DEM GLO-30. It writes:

- `static/trishuli/event_evidence.json`: event measurements, gauge snapshots,
  attributed observations and related work.
- `static/trishuli/event_observations.geojson`: the spatial evidence layer used
  by the public map.

## Claim boundary

The USGS point is a seismic-source location, not a mapped collapse polygon. DHM
telemetry cessation is observable, but its cause is unknown and is not treated
as a flood-arrival time. The 20 km blockage distance is an attributed official
preliminary report, not a geometry measured by this script. No asset proximity
is interpreted as damage.

## Contributions

Use the repository's **Trishuli evidence contribution** issue template. Every
submission should include an observation time, location or spatial footprint,
source, licence/redistribution terms and a clear distinction between direct
observation and interpretation.
