"""Behavioral tests for the distributed stdlib uploader, using only a local stub."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HELPER = Path(__file__).resolve().parents[1] / "skills/freebbs-course-upload/scripts/freebbs_course_upload.py"
spec = importlib.util.spec_from_file_location("freebbs_course_upload", HELPER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
TOKEN = "fbcu_" + "a" * 43


class Handler(BaseHTTPRequestHandler):
    requests = []
    revision = "r1"
    missing = False

    def log_message(self, *args):
        pass

    def handle_api(self):
        payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"null")
        self.requests.append((self.command, self.path, self.headers.get("Authorization"), payload))
        if self.path.endswith("/redirect"):
            self.send_response(302)
            self.send_header("Location", "/should-not-follow")
            self.end_headers()
            return
        if self.path.endswith("/denied"):
            status, body = 403, {"message": "没有课程权限"}
        elif self.path.endswith("/nodes/SS-01-01"):
            if self.command == "GET":
                status, body = (404, {"message": "不存在"}) if self.missing else (200, {"node": {"revision": self.revision}})
            elif payload.get("expectedRevision") != ("new" if self.missing else self.revision):
                status, body = 409, {"message": "请重新读取"}
            else:
                status, body = 200, {"node": payload}
        elif self.path.endswith("/files"):
            status, body = 201, {"file": {"fileName": payload["fileName"], "size": len(base64.b64decode(payload["contentBase64"]))}}
        else:
            status, body = 200, {"courses": [{"slug": "signals"}]}
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    do_GET = handle_api
    do_POST = handle_api
    do_PUT = handle_api


class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        Handler.requests.clear()
        Handler.missing = False
        self.client = module.Client(self.origin, TOKEN)

    def test_token_only_in_header_and_cli_environment(self):
        self.client.request("GET", "/courses")
        self.assertEqual(Handler.requests[-1][2], "Bearer " + TOKEN)
        self.assertNotIn(TOKEN, Handler.requests[-1][1])
        result = subprocess.run(["python3", str(HELPER), "courses"], env={**os.environ, "FREEBBS_BASE_URL": self.origin, "FREEBBS_UPLOAD_TOKEN": TOKEN}, capture_output=True, text=True, check=True)
        self.assertIn("signals", result.stdout)
        self.assertNotIn(TOKEN, result.stdout + result.stderr)

    def test_put_reads_revision_and_preserves_explicit_revision(self):
        body = self.client.put_node("signals", "SS-01-01", {"sections": {"knowledgeMarkdown": "正文"}})
        self.assertEqual(body["node"]["expectedRevision"], "r1")
        self.assertEqual([item[0] for item in Handler.requests], ["GET", "PUT"])
        with self.assertRaises(module.ApiError) as error:
            self.client.put_node("signals", "SS-01-01", {"title": "new", "expectedRevision": "stale"})
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(len(Handler.requests), 3)  # No retry or overwritten revision.

    def test_create_uses_new_and_upload_uses_basename(self):
        Handler.missing = True
        result = self.client.put_node("signals", "SS-01-01", {"title": "新节点"})
        self.assertEqual(result["node"]["expectedRevision"], "new")
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "讲义.md"
            source.write_text("# 正文", encoding="utf-8")
            uploaded = self.client.upload("signals", source)
            self.assertEqual(uploaded["file"]["fileName"], "讲义.md")
            self.assertEqual(uploaded["file"]["size"], len("# 正文".encode()))

    def test_http_and_redirect_and_permission_errors_stop(self):
        for origin in ["http://example.test", "https://user:pass@example.test", "https://example.test/api", "https://example.test/?token=x"]:
            with self.assertRaises(ValueError):
                module.Client(origin, TOKEN)
        with self.assertRaises(module.ApiError) as denied:
            self.client.request("GET", "/denied")
        self.assertEqual(denied.exception.status, 403)
        with self.assertRaises(module.ApiError):
            self.client.request("GET", "/redirect")
        self.assertEqual(len(Handler.requests), 2)


if __name__ == "__main__":
    unittest.main()
