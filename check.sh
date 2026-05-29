#!/bin/bash
echo " Gunicorn running"
ps aux | grep gunicorn | grep -v grep | wc -l | xargs echo "workers:"

echo "Port 8000 listening?"
ss -tlnp | grep 8000

echo "=== App responding? ==="
curl -s -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" http://localhost:8000

echo "COG file exists?"
ls -lh data/cogs/Metric=CWBPT/Period=2050-2079/Month=7.tif

echo "COG serving? "
curl -s -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" \
  -H "Range: bytes=0-1023" \
  http://localhost:8000/cogs/Metric=CWBPT/Period=2050-2079/Month=7.tif

echo "Recent errors "
tail -20 ../logs/gunicorn.log | grep -i error
