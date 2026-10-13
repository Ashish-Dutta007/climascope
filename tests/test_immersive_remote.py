"""Remote protocol tests without loading the climate datasets."""
from pathlib import Path
import tempfile
import unittest

from flask import Flask

from immersive_remote import init_remote


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "remote.sqlite3")
        self.now = [1000000.0]
        self.apps = []
        for _ in range(2):
            app = Flask(__name__)
            app.config.update(TESTING=True, IMMERSIVE_REMOTE_DB=self.path)
            init_remote(app)
            app.extensions["immersive_remote_store"].clock = lambda: self.now[0]
            self.apps.append(app)
        self.wall = self.apps[0].test_client()
        self.phone = self.apps[1].test_client()
        self.root = "/api/immersive/remote"

    def tearDown(self):
        self.temp.cleanup()

    def create(self):
        r = self.wall.post(self.root + "/rooms", json={})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.headers["Cache-Control"], "no-store")
        return r.json

    def pair(self, room):
        r = self.phone.post(self.root + "/pair", json={"code": room["code"]})
        self.assertEqual(r.status_code, 200)
        return r.json

    def headers(self, credentials):
        return {"Authorization": "Bearer " + credentials["token"]}

    def path_for(self, credentials, suffix):
        return self.root + "/rooms/" + credentials["room"] + suffix

    def send(self, credentials, message, nonce="message-00001", client=None):
        return (client or self.phone).post(self.path_for(credentials, "/messages"),
            headers=self.headers(credentials), json={"nonce": nonce, "message": message})

    def poll(self, credentials, after=0, client=None):
        return (client or self.wall).get(self.path_for(credentials, "/messages?after=" + str(after)),
                                        headers=self.headers(credentials))

    def test_cross_worker_delivery_and_cursor(self):
        room = self.create()
        phone = self.pair(room)
        message = {"type": "state", "month": 8, "member": "mean", "region": {"name": "All Scotland"}}
        self.assertEqual(self.send(phone, message).status_code, 200)
        r = self.poll(room)
        self.assertEqual(r.json["messages"], [message])
        self.assertTrue(r.json["peer_online"])
        self.assertEqual(self.poll(room, r.json["cursor"]).json["messages"], [])
        self.assertEqual(self.poll(phone).json["messages"], [])

    def test_retry_does_not_repeat_step(self):
        room = self.create()
        phone = self.pair(room)
        command = {"type": "command", "cmd": "step", "delta": 1}
        first = self.send(phone, command)
        second = self.send(phone, command)
        self.assertEqual(first.json, second.json)
        self.assertEqual(len(self.poll(room).json["messages"]), 1)

    def test_pair_code_single_use_and_expiry(self):
        room = self.create()
        self.pair(room)
        self.assertEqual(self.phone.post(self.root + "/pair", json={"code": room["code"]}).status_code, 404)
        other = self.create()
        self.now[0] += 601
        self.assertEqual(self.phone.post(self.root + "/pair", json={"code": other["code"]}).status_code, 404)

    def test_another_room_cannot_control_this_wall(self):
        a, b = self.create(), self.create()
        phone = self.pair(a)
        wrong = dict(phone, room=b["room"])
        self.assertEqual(self.send(wrong, {"type": "state", "month": 8}).status_code, 403)
        self.assertEqual(self.poll(b).json["messages"], [])

    def test_unpaired_requests_and_wrong_roles_are_rejected(self):
        room = self.create()
        self.assertEqual(self.phone.get(self.path_for(room, "/messages")).status_code, 403)
        phone = self.pair(room)
        self.assertEqual(self.send(phone, {"type": "wall"}).status_code, 400)
        self.assertEqual(self.send(room, {"type": "command", "cmd": "play"}).status_code, 400)
        self.assertEqual(self.phone.post(self.path_for(phone, "/code"), json={}, headers=self.headers(phone)).status_code, 403)

    def test_new_pairing_replaces_old_controller(self):
        room = self.create()
        phone = self.pair(room)
        r = self.wall.post(self.path_for(room, "/code"), json={}, headers=self.headers(room))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(self.poll(room).json["pair_available"])
        new = self.pair(dict(room, code=r.json["code"]))
        self.assertFalse(self.poll(room).json["pair_available"])
        self.assertEqual(self.poll(phone).status_code, 403)
        self.assertEqual(self.poll(new).status_code, 200)

    def test_offline_commands_rejected_and_old_commands_expire(self):
        room = self.create()
        phone = self.pair(room)
        self.send(phone, {"type": "state", "month": 8})
        self.now[0] += 16
        self.assertEqual(self.send(phone, {"type": "state", "month": 9}, "message-00002").status_code, 409)
        data = self.poll(room).json
        self.assertEqual(data["messages"], [])
        self.assertGreater(data["cursor"], 0)

    def test_wall_report_reaches_phone(self):
        room = self.create()
        phone = self.pair(room)
        report = {"type": "wall", "status": "loading", "state": {"month": 8}, "shown": {"month": 7}}
        self.assertEqual(self.send(room, report, client=self.wall).status_code, 200)
        self.assertEqual(self.poll(phone, client=self.phone).json["report"], report)

    def test_full_selections_are_coalesced(self):
        room = self.create()
        phone = self.pair(room)
        self.send(phone, {"type": "state", "month": 8}, "message-00001")
        self.send(phone, {"type": "state", "month": 9}, "message-00002")
        self.assertEqual(self.poll(room).json["messages"], [{"type": "state", "month": 9}])

    def test_invalid_inputs_and_cross_origin_writes(self):
        room = self.create()
        phone = self.pair(room)
        for payload in [None, [], {"type": []}, {"type": "state", "month": True},
                        {"type": "state", "month": 13}, {"type": "state", "member": []},
                        {"type": "command", "cmd": []}, {"type": "state", "region": "Scotland"},
                        {"type": "command", "cmd": "set", "scene": []},
                        {"type": "command", "cmd": "set", "scene": "unknown"},
                        {"type": "command", "cmd": "set", "focus": "unknown"},
                        {"type": "command", "cmd": "play", "playback": "unknown"}]:
            with self.subTest(payload=payload):
                self.assertEqual(self.send(phone, payload).status_code, 400)
        self.assertEqual(self.phone.post(self.root + "/pair", json={"code": room["code"]},
                                        headers={"Origin": "https://different.example"}).status_code, 403)
        self.assertEqual(self.poll(room, -1).status_code, 400)
        self.assertEqual(self.wall.post(self.root + "/rooms", data="{}").status_code, 415)

    def test_scene_selection_and_tour_cross_workers(self):
        room = self.create()
        phone = self.pair(room)
        commands = [
            {"type": "command", "cmd": "set", "scene": "landscape"},
            {"type": "command", "cmd": "set", "scene": "agreement", "focus": "Tmax_mean"},
            {"type": "command", "cmd": "tour"},
            {"type": "command", "cmd": "play", "playback": "months"},
        ]
        for i, command in enumerate(commands):
            self.assertEqual(self.send(phone, command, "scene-test-%04d" % i).status_code, 200)
        self.assertEqual(self.poll(room).json["messages"], commands)

    def test_rate_limits_shared_across_workers(self):
        for i in range(30):
            client = self.wall if i % 2 else self.phone
            self.assertEqual(client.post(self.root + "/pair", json={"code": "ZZZZZZZZ"}).status_code, 404)
        self.assertEqual(self.phone.post(self.root + "/pair", json={"code": "ZZZZZZZZ"}).status_code, 429)

    def test_session_expiry(self):
        room = self.create()
        self.now[0] += 12 * 60 * 60 + 1
        self.assertEqual(self.poll(room).status_code, 410)


if __name__ == "__main__":
    unittest.main()
