"""Small, room-scoped relay for the immersive wall and its phone controller.

The climate app remains responsible for rendering and data. This module only
relays the existing wall/controller messages, across devices and workers.
"""
from contextlib import closing, contextmanager
import hashlib
import json
import os
import re
import secrets
import sqlite3
import tempfile
import threading
import time
from urllib.parse import urlsplit

from flask import Blueprint, current_app, jsonify, request


SESSION_SECONDS = 12 * 60 * 60
PAIR_SECONDS = 10 * 60
MESSAGE_SECONDS = 15
MAX_MESSAGE_BYTES = 2 * 1024 * 1024  # v3 messages can contain council polygons
CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
MEMBERS = {"mean", "01", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "15"}
remote = Blueprint("immersive_remote", __name__, url_prefix="/api/immersive/remote")


class RemoteError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def _digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class RemoteStore:
    def __init__(self, path, clock=time.time):
        self.path, self.clock = path, clock
        self._initialized = False
        self._lock = threading.Lock()

    def _initialize(self):
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
            fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
            os.close(fd)
            with closing(sqlite3.connect(self.path, timeout=5)) as db:
                db.execute("PRAGMA journal_mode=WAL")
                db.executescript("""
                    CREATE TABLE IF NOT EXISTS rooms (
                        id TEXT PRIMARY KEY, wall_hash TEXT NOT NULL,
                        controller_hash TEXT, pair_hash TEXT UNIQUE,
                        pair_expires REAL NOT NULL, expires REAL NOT NULL,
                        wall_seen REAL NOT NULL, controller_seen REAL NOT NULL DEFAULT 0,
                        report TEXT
                    );
                    CREATE TABLE IF NOT EXISTS messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        room TEXT NOT NULL, sender TEXT NOT NULL,
                        nonce TEXT NOT NULL, kind TEXT NOT NULL,
                        payload TEXT NOT NULL, created REAL NOT NULL,
                        UNIQUE(room, sender, nonce)
                    );
                    CREATE INDEX IF NOT EXISTS messages_room ON messages(room, id);
                    CREATE TABLE IF NOT EXISTS limits (
                        key TEXT PRIMARY KEY, started REAL NOT NULL, count INTEGER NOT NULL
                    );
                """)
            self._initialized = True

    @contextmanager
    def connection(self):
        self._initialize()
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def limit(self, key, maximum):
        now = self.clock()
        with self.connection() as db:
            row = db.execute("SELECT * FROM limits WHERE key=?", (key,)).fetchone()
            if row and now - row["started"] < 60:
                if row["count"] >= maximum:
                    raise RemoteError("Too many attempts; wait a minute and try again.", 429)
                db.execute("UPDATE limits SET count=count+1 WHERE key=?", (key,))
            else:
                db.execute("INSERT OR REPLACE INTO limits VALUES (?, ?, 1)", (key, now))
            db.execute("DELETE FROM limits WHERE started < ?", (now - 3600,))

    def _authorize(self, db, room, token):
        row = db.execute("SELECT * FROM rooms WHERE id=?", (room,)).fetchone()
        if row is None or row["expires"] <= self.clock():
            raise RemoteError("This wall session has expired. Connect again.", 410)
        digest = _digest(token)
        for role in ("wall", "controller"):
            expected = row[role + "_hash"]
            if expected and secrets.compare_digest(expected, digest):
                return row, role
        raise RemoteError("Connect to this wall again.", 403)

    def create(self):
        now = self.clock()
        room, token = secrets.token_hex(16), secrets.token_urlsafe(32)
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
        with self.connection() as db:
            db.execute("DELETE FROM messages WHERE room IN (SELECT id FROM rooms WHERE expires<=?)", (now,))
            db.execute("DELETE FROM rooms WHERE expires<=?", (now,))
            if db.execute("SELECT COUNT(*) FROM rooms").fetchone()[0] >= 100:
                raise RemoteError("Remote sessions are busy; try again later.", 503)
            db.execute("INSERT INTO rooms(id,wall_hash,pair_hash,pair_expires,expires,wall_seen) VALUES(?,?,?,?,?,?)",
                       (room, _digest(token), _digest(code), now + PAIR_SECONDS, now + SESSION_SECONDS, now))
        return {"room": room, "token": token, "code": code, "code_expires": now + PAIR_SECONDS}

    def pair(self, code):
        now, token = self.clock(), secrets.token_urlsafe(32)
        with self.connection() as db:
            row = db.execute("SELECT * FROM rooms WHERE pair_hash=? AND pair_expires>? AND expires>?",
                             (_digest(code), now, now)).fetchone()
            if row is None:
                raise RemoteError("Code not found or expired. Use the code shown on the wall.", 404)
            if now - row["wall_seen"] > 10:
                raise RemoteError("The wall is offline. Reconnect it before pairing.", 409)
            db.execute("UPDATE rooms SET controller_hash=?, controller_seen=?, pair_hash=NULL, pair_expires=0 WHERE id=?",
                       (_digest(token), now, row["id"]))
            return {"room": row["id"], "token": token, "report": json.loads(row["report"]) if row["report"] else None}

    def new_code(self, room, token):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
        until = self.clock() + PAIR_SECONDS
        with self.connection() as db:
            _, role = self._authorize(db, room, token)
            if role != "wall":
                raise RemoteError("Only the wall can issue a connection code.", 403)
            db.execute("UPDATE rooms SET pair_hash=?,pair_expires=? WHERE id=?", (_digest(code), until, room))
        return {"code": code, "code_expires": until}

    def poll(self, room, token, after):
        now = self.clock()
        with self.connection() as db:
            row, role = self._authorize(db, room, token)
            db.execute(f"UPDATE rooms SET {role}_seen=? WHERE id=?", (now, room))
            messages = db.execute("SELECT * FROM messages WHERE room=? AND sender!=? AND id>? ORDER BY id LIMIT 100",
                                  (room, role, after)).fetchall()
            cursor = max([after] + [m["id"] for m in messages])
            incoming = [json.loads(m["payload"]) for m in messages if now - m["created"] <= MESSAGE_SECONDS]
            peer_seen = row["controller_seen" if role == "wall" else "wall_seen"]
            return {"cursor": cursor, "messages": incoming, "peer_online": bool(peer_seen and now - peer_seen <= 10),
                    "paired": bool(row["controller_hash"]),
                    "pair_available": bool(row["pair_hash"] and row["pair_expires"] > now),
                    "report": json.loads(row["report"]) if row["report"] else None}

    def send(self, room, token, nonce, payload):
        now = self.clock()
        with self.connection() as db:
            row, role = self._authorize(db, room, token)
            allowed = {"wall", "ping", "state"} if role == "wall" else {"command", "state", "ping", "hello"}
            if not isinstance(payload.get("type"), str) or payload["type"] not in allowed:
                raise RemoteError("Unsupported remote message.")
            if role == "controller" and now - row["wall_seen"] > 10:
                raise RemoteError("The wall is offline; the command was not sent.", 409)
            _validate_message(payload)
            raw = json.dumps(payload, allow_nan=False, separators=(",", ":"))
            db.execute("INSERT OR IGNORE INTO messages(room,sender,nonce,kind,payload,created) VALUES(?,?,?,?,?,?)",
                       (room, role, nonce, payload["type"], raw, now))
            message = db.execute("SELECT id FROM messages WHERE room=? AND sender=? AND nonce=?",
                                 (room, role, nonce)).fetchone()
            if role == "wall" and payload["type"] == "wall":
                db.execute("UPDATE rooms SET report=?,wall_seen=? WHERE id=?", (raw, now, room))
            # A full selection supersedes earlier selections; renderer snapshots
            # also supersede earlier reports. Large legacy region geometries must
            # not build up as hundreds of copies in /dev/shm.
            if payload["type"] in {"state", "wall"}:
                db.execute("DELETE FROM messages WHERE room=? AND sender=? AND kind=? AND id!=?",
                           (room, role, payload["type"], message["id"]))
            db.execute("DELETE FROM messages WHERE room=? AND created<?", (room, now - MESSAGE_SECONDS))
            # Retain a bounded inbox. A disconnected client must not replay old clicks.
            db.execute("DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE room=? ORDER BY id DESC LIMIT -1 OFFSET 200)", (room,))
            return {"accepted": True, "message_id": message["id"]}


def _validate_message(payload):
    if not isinstance(payload, dict):
        raise RemoteError("Message must be an object.")
    if not isinstance(payload.get("type"), str):
        raise RemoteError("Message type must be a string.")
    if payload.get("type") == "command" and (not isinstance(payload.get("cmd"), str) or payload["cmd"] not in {"set", "step", "play", "pause", "dwell", "tour"}):
        raise RemoteError("Unknown wall command.")
    if payload.get("type") in {"state", "command"}:
        if "month" in payload and (type(payload["month"]) is not int or not 1 <= payload["month"] <= 12):
            raise RemoteError("Month must be 1–12.")
        if "member" in payload and (not isinstance(payload["member"], str) or payload["member"] not in MEMBERS):
            raise RemoteError("Unknown ensemble member.")
        if "region" in payload and (not isinstance(payload["region"], dict) or not isinstance(payload["region"].get("name"), str)):
            raise RemoteError("Region must include its name.")
        if "scene" in payload and (not isinstance(payload["scene"], str) or payload["scene"] not in {"overview", "focus-water", "focus-rain", "focus-heat", "water-extent", "landscape", "agreement"}):
            raise RemoteError("Unknown wall scene.")
        if "focus" in payload and (not isinstance(payload["focus"], str) or payload["focus"] not in {"CWBPT", "Prec_sum", "Tmax_mean"}):
            raise RemoteError("Unknown focus metric.")
        if "playback" in payload and (not isinstance(payload["playback"], str) or payload["playback"] not in {"months", "tour"}):
            raise RemoteError("Unknown playback mode.")
    try:
        raw = json.dumps(payload, allow_nan=False)
    except (ValueError, TypeError):
        raise RemoteError("Message contains invalid values.")
    if len(raw.encode()) > MAX_MESSAGE_BYTES:
        raise RemoteError("Remote message is too large.", 413)


@remote.errorhandler(RemoteError)
def remote_error(exc):
    return jsonify({"error": exc.message}), exc.status


@remote.after_request
def no_cache(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@remote.before_request
def check_write():
    if request.method == "POST":
        origin = request.headers.get("Origin")
        if origin and urlsplit(origin).netloc != request.host:
            raise RemoteError("Open the remote on this ClimaScope site.", 403)
        if not request.is_json:
            raise RemoteError("JSON required.", 415)
        if request.content_length and request.content_length > MAX_MESSAGE_BYTES + 1024:
            raise RemoteError("Remote message is too large.", 413)


def _body():
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        raise RemoteError("JSON object required.")
    return value


def _token():
    value = request.headers.get("Authorization", "")
    if not value.startswith("Bearer ") or not 20 <= len(value[7:]) <= 100:
        raise RemoteError("Connect to this wall first.", 403)
    return value[7:]


def _store():
    return current_app.extensions["immersive_remote_store"]


@remote.post("/rooms")
def create_room():
    _body()
    _store().limit("create:" + (request.remote_addr or "unknown"), 10)
    return jsonify(_store().create()), 201


@remote.post("/pair")
def pair_room():
    _store().limit("pair:" + (request.remote_addr or "unknown"), 30)
    code = _body().get("code", "")
    if not isinstance(code, str):
        raise RemoteError("Enter the wall's connection code.")
    code = re.sub(r"[\s-]", "", code.upper())
    if len(code) != 8 or any(c not in CODE_ALPHABET for c in code):
        raise RemoteError("Enter the eight-character code shown on the wall.")
    return jsonify(_store().pair(code))


@remote.get("/rooms/<room>/messages")
def poll_room(room):
    try:
        after = int(request.args.get("after", "0"))
        if not 0 <= after <= 2**63 - 1:
            raise ValueError
    except ValueError:
        raise RemoteError("Invalid message cursor.")
    return jsonify(_store().poll(room, _token(), after))


@remote.post("/rooms/<room>/messages")
def send_message(room):
    body = _body()
    nonce, payload = body.get("nonce"), body.get("message")
    if not isinstance(nonce, str) or not 8 <= len(nonce) <= 80:
        raise RemoteError("Message identifier required.")
    _validate_message(payload)
    return jsonify(_store().send(room, _token(), nonce, payload))


@remote.post("/rooms/<room>/code")
def refresh_code(room):
    _body()
    return jsonify(_store().new_code(room, _token()))


def init_remote(app):
    default_dir = "/dev/shm" if os.path.isdir("/dev/shm") else tempfile.gettempdir()
    path = app.config.get("IMMERSIVE_REMOTE_DB") or os.environ.get("IMMERSIVE_REMOTE_DB", os.path.join(default_dir, "climascope-remote.sqlite3"))
    app.extensions["immersive_remote_store"] = RemoteStore(path)
    app.register_blueprint(remote)
