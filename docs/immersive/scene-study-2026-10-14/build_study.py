from pathlib import Path
import base64
import gzip
import hashlib
import json
import math
import numpy as np
import pandas as pd
import geopandas as gpd

APP = Path(__file__).resolve().parents[3]
OUT = APP / 'docs/immersive/scene-study-2026-10-14'
MEMBERS = ['01', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '15']
METRICS = ['CWBPT', 'Prec_sum', 'Tmax_mean', 'ETPT_sum']
summary = json.loads((APP / 'static/immersive/summaries/v2/mean.json').read_text())
g = gpd.read_parquet(APP / 'data/grid.parquet').sort_values('id_1km')
centres = g.geometry.centroid
x = np.rint((centres.x.to_numpy() - 55500) / 1000).astype('<u2')
y = np.rint((1217500 - centres.y.to_numpy()) / 1000).astype('<u2')
coords = np.column_stack([x, y]).astype('<u2').tobytes()
assert len(set(zip(x.tolist(), y.tolist()))) == len(g)
pieces, frames, sources = [], {}, []
offset = 0


def raw_change(metric, member, month):
    root = APP / f'data/precomputed/Metric={metric}/Period=2050-2079'
    p = root / (f'Month={month}.parquet' if member == 'mean' else f'Month={month}/Member={member}.parquet')
    source = pd.read_parquet(p, columns=['id_1km', 'obs_value', 'proj_value']).set_index('id_1km')
    return p, source.proj_value.astype(float) - source.obs_value.astype(float)


member_domains = {}
for metric in METRICS[:3]:
    values = np.concatenate([raw_change(metric, member, 7)[1].to_numpy() for member in MEMBERS])
    values = values[np.isfinite(values)]
    step = 1 if metric == 'Tmax_mean' else 10
    limit = max(step, math.ceil(float(np.quantile(np.abs(values), .95)) / step) * step)
    member_domains[metric] = {
        'limit': limit, 'month': 7, 'members': MEMBERS,
        'basis': 'symmetric about zero; 95th percentile of absolute July cell changes pooled across all 12 members, rounded outward',
        'raw_min': float(values.min()), 'raw_max': float(values.max()),
        'clipped_fraction': float((np.abs(values) > limit).mean()),
    }
    print(metric, 'July member domain', limit, 'clipped fraction', member_domains[metric]['clipped_fraction'], flush=True)

def pack(metric, member, month):
    global offset
    p, raw = raw_change(metric, member, month)
    series = raw.reindex(g.id_1km)
    limit = member_domains[metric]['limit'] if member != 'mean' else (6 if metric == 'Tmax_mean' else 160)
    values = series.to_numpy()
    good = np.isfinite(values)
    bins = np.zeros(len(g), dtype='u1')
    bins[good] = (np.rint((np.clip(values[good] / limit, -1, 1) + 1) * 127) + 1).astype('u1')
    region = summary['regions']['national'][metric]
    if member == 'mean':
        mean = region['2050-2079'][month - 1] - region['1990-2019'][month - 1]
    else:
        member_summary = json.loads((APP / f'static/immersive/summaries/v2/member_{member}.json').read_text())
        mean = member_summary['regions']['national'][metric]['2050-2079'][month - 1] - region['1990-2019'][month - 1]
    frames[f'{metric}:{member}:{month-1}'] = {
        'offset': offset, 'mean': round(mean, 6),
        'limit': limit, 'clip_low': bool((raw < -limit).any()), 'clip_high': bool((raw > limit).any()),
        'mapped_valid_cells': int(good.sum()), 'source_cells': int(np.isfinite(raw).sum()),
        'unmapped_source_cells': len(set(raw.index) - set(g.id_1km)),
    }
    sources.append({'path': str(p.relative_to(APP)), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()})
    pieces.append(bins.tobytes())
    offset += len(bins)

for metric in METRICS:
    for month in range(1, 13):
        pack(metric, 'mean', month)
    print(metric, 'annual maps read', flush=True)
for metric in METRICS[:3]:
    for member in MEMBERS:
        pack(metric, member, 7)
    print(metric, 'member maps read', flush=True)

blob = coords + b''.join(pieces)
data = {
    'grid': {'width': int(x.max()) + 1, 'height': int(y.max()) + 1, 'cells': len(g), 'crs': 'EPSG:27700'},
    'coordinateBytes': len(coords), 'members': MEMBERS, 'frames': frames,
    'packed': base64.b64encode(gzip.compress(blob, mtime=0)).decode(),
    'climate_version': summary['_meta']['data_version'],
    'member_domains': member_domains,
}
p = OUT / 'index.html'
text = p.read_text()
opening = '<script id="study-data" type="application/json">'
assert text.count(opening) == 1
head, sep, rest = text.partition(opening)
old, close, tail = rest.partition('</script>')
assert close
p.write_text(head + sep + json.dumps(data, separators=(',', ':')) + close + tail)
(OUT / 'sources.json').write_text(json.dumps({
    'climate_version': data['climate_version'], 'grid': data['grid'],
    'grid_source': 'data/grid.parquet', 'maps': len(frames), 'frames': frames,
    'map_encoding': 'raw proj_value minus obs_value, clipped to the fixed map domain; 255 colour bins, 0 = no data',
    'water_component_scale': '+/-160 mm shared; ET map displays -deltaET as its contribution to water-balance change',
    'other_scales': 'year view uses current production domains: precipitation/CWB +/-160 mm; Tmax +/-6 C',
    'member_domains': member_domains,
    'number_source': 'current v2 regional summaries, common-valid-support means, differenced before display rounding',
    'geometry_note': 'Available grid.parquet has 78,820 cells. Source climate files have 78,855; 35 lack geometry in this study. National numbers use the full official regional support, not a mean of the displayed subset.',
    'sources': sources,
}, indent=2))
print('Wrote', p, 'bytes', p.stat().st_size, 'map frames', len(frames), 'raw bytes', len(blob), flush=True)
