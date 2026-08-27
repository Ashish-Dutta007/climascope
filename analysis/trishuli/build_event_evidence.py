#!/usr/bin/env python3
"""Build the public, machine-readable Trishuli event evidence snapshot."""

from __future__ import annotations

import html
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import rasterio
import requests
from pyproj import Geod


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "static" / "trishuli"
NPT = timezone(timedelta(hours=5, minutes=45))
EVENT_ID = "us7000tbwb"
USGS_URL = f"https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid={EVENT_ID}"
DHM_BASE = "https://dhm.gov.np"
DEM_URL = (
    "/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/"
    "Copernicus_DSM_COG_10_N28_00_E085_00_DEM/"
    "Copernicus_DSM_COG_10_N28_00_E085_00_DEM.tif"
)
RASUWAGADHI = (85.377649, 28.271297)

STATIONS = [
    {"id": 4913, "series_id": 23251, "name": "Rasuwagadhi", "role": "mainstem", "warning_m": 6.0},
    {"id": 191, "series_id": 2810, "name": "Syabrubesi", "role": "mainstem", "warning_m": 5.5},
    {"id": 190, "series_id": 2788, "name": "Langtang at Syabrubesi", "role": "tributary", "warning_m": 3.75},
    {"id": 4657, "series_id": 19916, "name": "Dhunche", "role": "tributary", "warning_m": 3.2},
    {"id": 52, "series_id": 943, "name": "Betrawati", "role": "mainstem", "warning_m": 4.1},
]


def text_cells(markup: str) -> list[str]:
    cells = re.findall(r"<td[^>]*>(.*?)</td>", markup, flags=re.I | re.S)
    return [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html.unescape(cell))).strip() for cell in cells]


def dhm_station(session: requests.Session, station: dict) -> dict:
    page_url = f"{DHM_BASE}/hydrology/hms-Single/{station['id']}"
    page = session.get(page_url, timeout=30)
    page.raise_for_status()
    token = re.search(r'name="csrf_test_name" value="([^"]+)', page.text)
    river = re.search(r"var river = '(\{.*?\})';", page.text)
    if not token or not river:
        raise RuntimeError(f"Could not parse DHM station page {station['id']}")
    metadata = json.loads(html.unescape(river.group(1)))
    response = session.post(
        f"{DHM_BASE}/site/getRiverWatchBySeriesId_Single",
        data={
            "csrf_test_name": token.group(1),
            "date": "2026-08-26",
            "period": 1,
            "seriesid": station["series_id"],
        },
        headers={"Referer": page_url, "X-Requested-With": "XMLHttpRequest"},
        timeout=30,
    )
    response.raise_for_status()
    cells = text_cells(response.json()["data"]["table"])
    samples = []
    for date_text, value_text in zip(cells[0::2], cells[1::2]):
        observed = datetime.strptime(date_text, "%a, %b %d, %Y ,%H:%M").replace(tzinfo=NPT)
        samples.append({"time_npt": observed.isoformat(), "level_m": float(value_text)})
    samples.sort(key=lambda row: row["time_npt"])
    return {
        **station,
        "station_index": metadata.get("stationIndex"),
        "longitude": metadata["longitude"],
        "latitude": metadata["latitude"],
        "source_url": page_url,
        "samples": samples,
        "last_sample": samples[-1],
    }


def sample_dem(points: list[tuple[float, float]]) -> list[float]:
    os.environ.update(
        AWS_NO_SIGN_REQUEST="YES",
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
    )
    with rasterio.open(DEM_URL) as src:
        return [round(float(row[0])) for row in src.sample(points)]


def main() -> None:
    session = requests.Session()
    session.headers["User-Agent"] = "ClimaScope-Trishuli/0.3 (ashish.dutta@hutton.ac.uk)"

    usgs = session.get(USGS_URL, timeout=30)
    usgs.raise_for_status()
    event = usgs.json()
    props = event["properties"]
    source_lon, source_lat, _ = event["geometry"]["coordinates"]
    event_utc = datetime.fromtimestamp(props["time"] / 1000, timezone.utc)
    event_npt = event_utc.astimezone(NPT)

    source_elevation, border_elevation = sample_dem(
        [(source_lon, source_lat), RASUWAGADHI]
    )
    geod = Geod(ellps="WGS84")
    _, _, straight_distance_m = geod.inv(source_lon, source_lat, *RASUWAGADHI)

    gauges = [dhm_station(session, station) for station in STATIONS]
    for gauge in gauges:
        last = datetime.fromisoformat(gauge["last_sample"]["time_npt"])
        gauge["last_sample"]["minutes_after_mass_movement"] = round(
            (last - event_npt).total_seconds() / 60
        )

    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    evidence = {
        "schema_version": "1.0",
        "brief_version": "0.3.1",
        "generated_at_utc": generated,
        "event": {
            "id": EVENT_ID,
            "catalogue_class": props["type"],
            "catalogue_title": props["title"],
            "magnitude": props["mag"],
            "time_utc": event_utc.isoformat(),
            "time_npt": event_npt.isoformat(),
            "longitude": source_lon,
            "latitude": source_lat,
            "source_elevation_m": source_elevation,
            "rasuwagadhi_elevation_m": border_elevation,
            "relief_to_rasuwagadhi_m": source_elevation - border_elevation,
            "straight_distance_to_rasuwagadhi_km": round(straight_distance_m / 1000, 1),
            "reported_blockage_distance_upstream_km": 20,
            "source_url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000tbwb",
        },
        "gauges": gauges,
        "observations": [
            {
                "id": "obs-usgs-landslide",
                "tier": "retrieved observation",
                "statement": "USGS classifies the seismic source as an M 5.2 landslide, not an earthquake.",
                "source": "USGS",
                "source_url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000tbwb",
            },
            {
                "id": "obs-dhm-blockage",
                "tier": "official preliminary interpretation",
                "statement": "DHM officials reported imagery indicating a temporary debris blockage about 20 km upstream of Miteri Bridge and a subsequent breach.",
                "source": "DHM official quoted by The Kathmandu Post",
                "source_url": "https://kathmandupost.com/national/2026/08/26/ice-avalanche-debris-lake-may-have-triggered-bhotekoshi-flood",
            },
            {
                "id": "obs-gauge-silence",
                "tier": "retrieved observation",
                "statement": "Five DHM gauges in the corridor ceased transmitting between 08:40 and 09:20 NPT; their displayed warning status does not describe the flood peak.",
                "source": "Nepal DHM station observations",
                "source_url": "https://dhm.gov.np/hydrology/realtime-stream",
            },
        ],
    }

    features = [
        {
            "type": "Feature",
            "id": "usgs-source",
            "properties": {
                "kind": "source",
                "label": "USGS landslide source",
                "time_npt": event_npt.strftime("%H:%M:%S NPT"),
                "elevation_m": source_elevation,
                "evidence_tier": "retrieved observation",
                "source_url": evidence["event"]["source_url"],
            },
            "geometry": {"type": "Point", "coordinates": [source_lon, source_lat]},
        }
    ]
    for gauge in gauges:
        features.append(
            {
                "type": "Feature",
                "id": f"dhm-{gauge['id']}",
                "properties": {
                    "kind": "gauge",
                    "role": gauge["role"],
                    "label": gauge["name"],
                    "last_time_npt": datetime.fromisoformat(gauge["last_sample"]["time_npt"]).strftime("%H:%M NPT"),
                    "last_level_m": gauge["last_sample"]["level_m"],
                    "warning_m": gauge["warning_m"],
                    "evidence_tier": "retrieved observation",
                    "source_url": gauge["source_url"],
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [gauge["longitude"], gauge["latitude"]],
                },
            }
        )

    geojson = {"type": "FeatureCollection", "features": features}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "event_evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    (OUT / "event_observations.geojson").write_text(json.dumps(geojson, indent=2) + "\n")
    print(f"Wrote {OUT / 'event_evidence.json'}")
    print(f"Wrote {OUT / 'event_observations.geojson'}")


if __name__ == "__main__":
    main()
