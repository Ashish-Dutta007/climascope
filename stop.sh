#!/usr/bin/env bash
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$APP_DIR/gunicorn.pid"

if [ ! -f "$PIDFILE" ]; then
    echo "no pidfile found; trying pkill fallback"
    pkill -f "gunicorn.*app:app" && echo "stopped" || echo "no gunicorn process found"
    exit 0
fi

PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
    kill -TERM "$PID"
    echo "sent SIGTERM to gunicorn (pid $PID)"
    for i in $(seq 1 10); do
        sleep 1
        kill -0 "$PID" 2>/dev/null || { echo "gunicorn stopped"; rm -f "$PIDFILE"; exit 0; }
    done
    kill -KILL "$PID" 2>/dev/null
    echo "gunicorn force-killed"
else
    echo "process $PID not running"
fi
rm -f "$PIDFILE"
