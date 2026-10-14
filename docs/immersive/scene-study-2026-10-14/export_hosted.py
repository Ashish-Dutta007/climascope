"""Export the standalone study as static assets compatible with the app CSP.

Run with Python 3 from any directory. This writes only static/immersive/scene-study/;
it does not modify the live wall renderer or deploy anything.
"""
import json
from pathlib import Path
import re

STUDY = Path(__file__).resolve().parent
APP = STUDY.parents[2]
OUTPUT = APP / 'static/immersive/scene-study'

source = (STUDY / 'index.html').read_text()
data_match = re.search(r'<script id="study-data" type="application/json">(.*?)</script>', source, re.S)
assert data_match, 'Standalone study data is missing'
data = json.loads(data_match.group(1))
source = source[:data_match.start()] + source[data_match.end():]
code_match = re.search(r'<script>\s*(.*?)</script>', source, re.S)
assert code_match, 'Standalone study script is missing'
code = code_match.group(1)
old = "const d=JSON.parse($('#study-data').textContent);"
assert code.count(old) == 1
code = code.replace(old, "const response=await fetch('data.json');if(!response.ok)throw new Error('Study data is unavailable');const d=await response.json();")
source = source[:code_match.start()] + '<script src="study.js"></script>' + source[code_match.end():]
old = '<h1>ClimaScope · wall scene study</h1>'
assert source.count(old) == 1
source = source.replace(old, old + '\n <p><a href="/immersive/preview" style="color:#a9d7ff">Current wall views</a> · <a href="/immersive/preview?scene=agreement&amp;focus=CWBPT&amp;month=7" style="color:#a9d7ff">Current Member spread scene</a></p>')
assert '<script>' not in source
assert 'study-data' not in source
OUTPUT.mkdir(parents=True, exist_ok=True)
(OUTPUT / 'index.html').write_text(source)
(OUTPUT / 'study.js').write_text(code + '\n')
(OUTPUT / 'data.json').write_text(json.dumps(data, separators=(',', ':')))
print('Exported study to', OUTPUT)
for p in sorted(OUTPUT.iterdir()):
    print(p.name, p.stat().st_size, 'bytes')
