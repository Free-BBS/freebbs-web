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
MAX_SECTION_CHARACTERS = 500000


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

    def upload_node(self, course, node_id, markdown_file, *, title=None, summary=None,
                    basic_info=None, applications=None, x=None, y=None, expected_revision=None):
        sections = {}
        for name, source in [("knowledgeMarkdown", markdown_file),
                             ("basicInfoMarkdown", basic_info),
                             ("applicationsMarkdown", applications)]:
            if source is not None:
                file = Path(source)
                if file.stat().st_size > MAX_SECTION_CHARACTERS * 4:
                    raise ValueError("Each Markdown section must be at most 500000 characters")
                content = file.read_text(encoding="utf-8-sig")
                if len(content) > MAX_SECTION_CHARACTERS:
                    raise ValueError("Each Markdown section must be at most 500000 characters")
                sections[name] = content
        patch = {"sections": sections}
        for name, value in [("title", title), ("summary", summary), ("expectedRevision", expected_revision)]:
            if value is not None:
                patch[name] = value
        position = {name: value for name, value in [("x", x), ("y", y)] if value is not None}
        if position:
            patch["position"] = position
        return self.put_node(course, node_id, patch)

    def get_map(self, course):
        return self.request("GET", self.course_route(course) + "/map")

    def connect(self, course, source, target, edge_type="ordered"):
        if edge_type not in {"ordered", "related"}:
            raise ValueError("Connection type must be ordered or related")
        return self.request("POST", self.course_route(course) + "/map/edges",
                            {"source": source, "target": target, "type": edge_type})

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
    cmd = commands.add_parser("map", help="Read the course map, node positions and connections")
    cmd.add_argument("course")
    for name in ["get-node", "put-node"]:
        cmd = commands.add_parser(name)
        cmd.add_argument("course")
        cmd.add_argument("node_id")
        if name == "put-node":
            cmd.add_argument("json_file", help="UTF-8 JSON node patch")
    cmd = commands.add_parser("upload-node", help="Create or update a map knowledge point from Markdown")
    cmd.add_argument("course")
    cmd.add_argument("node_id")
    cmd.add_argument("markdown_file", help="UTF-8 Markdown knowledge content (not an attachment)")
    cmd.add_argument("--title", help="Knowledge point title; required when creating a node")
    cmd.add_argument("--summary", help="Short summary; omitted keeps the existing summary")
    cmd.add_argument("--basic-info", help="Optional UTF-8 Markdown file for the basic information section")
    cmd.add_argument("--applications", help="Optional UTF-8 Markdown file for the applications section")
    cmd.add_argument("--x", type=int, help="Map x coordinate, 0–10000; omitted keeps the current value")
    cmd.add_argument("--y", type=int, help="Map y coordinate, 0–10000; omitted keeps the current value")
    cmd.add_argument("--expected-revision", help="Revision from get-node, or new for creation; conflicting writes stop")
    cmd = commands.add_parser("connect", help="Connect two existing knowledge points in a course map")
    cmd.add_argument("course")
    cmd.add_argument("source")
    cmd.add_argument("target")
    cmd.add_argument("--type", choices=["ordered", "related"], default="ordered", dest="edge_type")
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
        elif args.command == "map":
            result = client.get_map(args.course)
        elif args.command == "get-node":
            result = client.get_node(args.course, args.node_id)
        elif args.command == "put-node":
            patch = json.loads(Path(args.json_file).read_text(encoding="utf-8"))
            result = client.put_node(args.course, args.node_id, patch)
        elif args.command == "upload-node":
            result = client.upload_node(args.course, args.node_id, args.markdown_file,
                                        title=args.title, summary=args.summary, basic_info=args.basic_info,
                                        applications=args.applications, x=args.x, y=args.y,
                                        expected_revision=args.expected_revision)
        elif args.command == "connect":
            result = client.connect(args.course, args.source, args.target, args.edge_type)
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
