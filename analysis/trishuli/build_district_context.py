#!/usr/bin/env python3
"""Extract the two district polygons intersected by the Trishuli corridor.

Each feature carries a label point. The map style has no ``glyphs`` URL and the
page CSP forbids fetching one, so district names are drawn as HTML markers
rather than symbol layers; the marker needs an explicit anchor inside the
polygon, which ``label_lon``/``label_lat`` provide.
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import requests
from shapely.geometry import shape


SOURCE_URL = (
    "https://data.humdata.org/dataset/07db728a-4f0f-4e98-8eb0-8fa9df61f01c/"
    "resource/dea34e50-37d5-4e36-98ae-2b7b1b4c43de/download/"
    "npl_admin_boundaries.geojson.zip"
)
MEMBER = "npl_admin2.geojson"
DISTRICTS = {"Rasuwa", "Nuwakot"}
OUT = Path(__file__).resolve().parents[2] / "static" / "trishuli" / "districts.geojson"


def label_point(geometry: dict) -> dict:
    """Anchor for the district's HTML label, guaranteed to sit inside the polygon.

    The area centroid reads best, but it falls outside concave or elongated
    districts, so fall back to a representative point when it does.
    """
    polygon = shape(geometry)
    point = polygon.centroid
    if not polygon.contains(point):
        point = polygon.representative_point()
    return {"label_lon": round(point.x, 5), "label_lat": round(point.y, 5)}


def main() -> None:
    response = requests.get(
        SOURCE_URL,
        headers={"User-Agent": "ClimaScope-Trishuli/0.3.1 ashish.dutta@hutton.ac.uk"},
        timeout=120,
    )
    response.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        source = json.load(archive.open(MEMBER))

    features = []
    for feature in source["features"]:
        properties = feature["properties"]
        if properties.get("adm2_name") not in DISTRICTS:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": properties["adm2_name"],
                    "pcode": properties["adm2_pcode"],
                    "province": properties["adm1_name"],
                    "area_sqkm": properties["area_sqkm"],
                    "valid_on": properties["valid_on"],
                    **label_point(feature["geometry"]),
                },
                "geometry": feature["geometry"],
            }
        )

    names = {feature["properties"]["name"] for feature in features}
    if names != DISTRICTS:
        raise RuntimeError(f"Expected {sorted(DISTRICTS)}, found {sorted(names)}")

    output = {
        "type": "FeatureCollection",
        "name": "Trishuli corridor district context",
        "source": "Nepal COD-AB; Survey Department of Nepal and UN Resident Coordinator's Office",
        "source_url": "https://data.humdata.org/dataset/cod-ab-npl",
        "license": "CC BY-IGO",
        "features": sorted(features, key=lambda feature: feature["properties"]["name"]),
    }
    OUT.write_text(json.dumps(output, separators=(",", ":")) + "\n")
    print(f"Wrote {OUT} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
