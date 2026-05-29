#!/usr/bin/env bash
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$APP_DIR/gunicorn.pid"
LOGFILE="$APP_DIR/../logs/gunicorn.log"

mkdir -p "$(dirname "$LOGFILE")"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "gunicorn already running (pid $(cat "$PIDFILE"))"
    exit 0
fi

cd "$APP_DIR"

"$APP_DIR/venv/bin/gunicorn" \
    --workers 4 \
    --threads 2 \
    --bind 0.0.0.0:8000 \
    --timeout 180 \
    --graceful-timeout 30 \
    --keep-alive 5 \
    --preload \
    --capture-output \
    --worker-tmp-dir /dev/shm \
    --pid "$PIDFILE" \
    --daemon \
    --access-logfile "$LOGFILE" \
    --error-logfile "$LOGFILE" \
    "app:app"

echo "gunicorn started (pid $(cat "$PIDFILE")), log: $LOGFILE"
