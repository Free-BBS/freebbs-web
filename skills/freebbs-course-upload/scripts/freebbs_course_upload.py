#!/usr/bin/env python3
"""Small stdlib client for the FREE-BBS course upload API."""
import argparse
import base64
import json
import mimetypes
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request

MAX_FILE_BYTES = 20 * 1024 * 1024


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ApiError(code, "Unexpected redirect; check FREEBBS_BASE_URL before retrying")


class Client:
    def __init__(self, base_url=None, token=None):
        self.base_url = (base_url or os.environ.get("FREEBBS_BASE_URL", "")).rstrip("/")
        self.token = token or os.environ.get("FREEBBS_UPLOAD_TOKEN", "")
        parsed = urllib.parse.urlsplit(self.base_url)
        local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if (parsed.scheme != "https" and not local_http) or not parsed.hostname:
            raise ValueError("Set FREEBBS_BASE_URL to the HTTPS site origin (HTTP is allowed only on localhost)")
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            raise ValueError("FREEBBS_BASE_URL must be the site origin without credentials, path or query")
        if not self.token or not self.token.startswith("fbcu_") or len(self.token) != 48:
            raise ValueError("Set FREEBBS_UPLOAD_TOKEN to the personal Token from FREE-BBS settings")
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, method, route, payload=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            self.base_url + "/api/course-upload" + route,
            data=body,
            method=method,
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"},
        )
        try:
            with self.opener.open(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read(8192)).get("message", "Request failed")
            except (ValueError, AttributeError):
                detail = "Request failed"
            finally:
                error.close()
            raise ApiError(error.code, f"HTTP {error.code}: {detail}") from None
        except urllib.error.URLError:
            raise ApiError(0, "Network request failed; inspect the current course state before retrying writes") from None

    @staticmethod
    def course_route(course):
        return "/courses/" + urllib.parse.quote(course, safe="")

    def get_node(self, course, node_id):
        return self.request("GET", self.course_route(course) + "/nodes/" + urllib.parse.quote(node_id, safe=""))

    def put_node(self, course, node_id, patch):
        if not isinstance(patch, dict):
            raise ValueError("Node JSON must be an object")
        patch = dict(patch)
        if "expectedRevision" not in patch:
            try:
                patch["expectedRevision"] = self.get_node(course, node_id)["node"]["revision"]
            except ApiError as error:
                if error.status != 404:
                    raise
                patch["expectedRevision"] = "new"
        return self.request("PUT", self.course_route(course) + "/nodes/" + urllib.parse.quote(node_id, safe=""), patch)

    def upload(self, course, file_path, image=False, node_id=None):
        source = Path(file_path)
        if not 0 < source.stat().st_size <= MAX_FILE_BYTES:
            raise ValueError("Upload files must be between 1 byte and 20 MB")
        content = source.read_bytes()
        encoded = base64.b64encode(content).decode("ascii")
        if image:
            mime = mimetypes.guess_type(source.name)[0]
            if mime not in {"image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"}:
                raise ValueError("Supported images: PNG, JPEG, WebP, GIF, AVIF")
            return self.request("POST", self.course_route(course) + "/images", {"imageDataUrl": f"data:{mime};base64,{encoded}"})
        payload = {"fileName": source.name, "contentBase64": encoded}
        if node_id:
            payload["nodeId"] = node_id
        return self.request("POST", self.course_route(course) + "/files", payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("courses", help="List currently managed courses")
    for name in ["get-node", "put-node"]:
        cmd = commands.add_parser(name)
        cmd.add_argument("course")
        cmd.add_argument("node_id")
        if name == "put-node":
            cmd.add_argument("json_file", help="UTF-8 JSON node patch")
    for name in ["files", "file", "image"]:
        cmd = commands.add_parser(name)
        cmd.add_argument("course")
        if name != "files":
            cmd.add_argument("path")
        if name == "file":
            cmd.add_argument("--node-id")
    cmd = commands.add_parser("map-request", help="Call an existing course map editor route")
    cmd.add_argument("course")
    cmd.add_argument("method", choices=["GET", "POST", "PUT", "PATCH", "DELETE"])
    cmd.add_argument("route", help="Route beneath /map, e.g. /background or /edges")
    cmd.add_argument("--json-file")
    args = parser.parse_args()
    try:
        client = Client()
        if args.command == "courses":
            result = client.request("GET", "/courses")
        elif args.command == "get-node":
            result = client.get_node(args.course, args.node_id)
        elif args.command == "put-node":
            patch = json.loads(Path(args.json_file).read_text(encoding="utf-8"))
            result = client.put_node(args.course, args.node_id, patch)
        elif args.command == "files":
            result = client.request("GET", client.course_route(args.course) + "/files")
        elif args.command in {"file", "image"}:
            result = client.upload(args.course, args.path, args.command == "image", getattr(args, "node_id", None))
        else:
            if not args.route.startswith("/") or any(part in args.route for part in ["..", "?", "#", "\\", "%"]):
                raise ValueError("Map route must be a relative /map path without traversal or query")
            payload = json.loads(Path(args.json_file).read_text(encoding="utf-8")) if args.json_file else None
            result = client.request(args.method, client.course_route(args.course) + "/map" + args.route, payload)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ApiError, ValueError, OSError) as error:
        # Never include request headers, environment values, or raw server error bodies.
        print(str(error).replace(os.environ.get("FREEBBS_UPLOAD_TOKEN", "\0"), "[redacted]"), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
