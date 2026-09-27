"""Loopback-only trusted Docker broker. Never executes authored code on the host."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import subprocess
import threading
import time

IMAGE = os.environ.get('LAB_WORKER_IMAGE', 'freebbs-language-lab:latest')
JOBS = {}
LOCK = threading.Lock()
SLOTS = threading.BoundedSemaphore(4)


def command(name):
    return ['docker', 'run', '--rm', '-i', '--name', name, '--network=none',
            '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--user=65534:65534', '--pids-limit=64', '--memory=512m', '--memory-swap=512m',
            '--cpus=1', '--ulimit=cpu=25:25', '--ulimit=fsize=16777216:16777216',
            '--ulimit=nofile=128:128', '--tmpfs=/tmp:rw,exec,nosuid,size=96m,mode=1777', IMAGE]


def stop(name):
    subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, timeout=10)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def log_message(self, *_):
        pass

    def reply(self, code, payload):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def do_GET(self):
        if self.path != '/health':
            return self.reply(404, {'message': 'Not found'})
        probe = subprocess.run(['docker', 'image', 'inspect', IMAGE], capture_output=True, timeout=10)
        self.reply(200 if probe.returncode == 0 else 503,
                   {'ready': probe.returncode == 0, 'languages': ['c', 'cpp', 'python', 'matlab', 'verilog']})

    def do_POST(self):
        size = int(self.headers.get('Content-Length', '0'))
        if not 0 < size <= 100000:
            return self.reply(413, {'message': 'Request too large'})
        try:
            payload = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeError):
            return self.reply(400, {'message': 'Invalid JSON'})
        if self.path.startswith('/control/'):
            name = self.path.removeprefix('/control/')
            with LOCK:
                job = JOBS.get(name)
            if not job:
                return self.reply(404, {'message': '运行已结束'})
            try:
                if payload.get('action') == 'stop':
                    stop(name)
                elif payload.get('action') in ('pause', 'resume', 'step', 'speed'):
                    job.stdin.write(json.dumps(payload) + '\n')
                    job.stdin.flush()
                else:
                    return self.reply(400, {'message': 'Invalid action'})
                return self.reply(200, {'ok': True})
            except (BrokenPipeError, OSError):
                return self.reply(409, {'message': '运行已结束'})
        if self.path != '/run':
            return self.reply(404, {'message': 'Not found'})
        name = payload.get('id', '')
        if not re.fullmatch(r'lab-[a-f0-9]{32}', name) or payload.get('language') not in ('c', 'cpp', 'python', 'matlab', 'verilog'):
            return self.reply(400, {'message': 'Invalid run'})
        if payload.get('optimization', '0') not in ('0', '1', '2', '3', 's'):
            return self.reply(400, {'message': 'Invalid optimization'})
        if not SLOTS.acquire(blocking=False):
            return self.reply(429, {'message': '运行环境繁忙，请稍后重试'})
        process = timer = None
        try:
            process = subprocess.Popen(command(name), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, text=True, bufsize=1)
            with LOCK:
                JOBS[name] = process
            process.stdin.write(json.dumps(payload) + '\n')
            process.stdin.flush()
            timer = threading.Timer(180, stop, args=(name,))
            timer.daemon = True
            timer.start()
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-ndjson')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            used, completed = 0, False
            for line in iter(lambda: process.stdout.readline(2 * 1024 * 1024), ''):
                used += len(line)
                if used > 12 * 1024 * 1024:
                    raise RuntimeError('运行输出超出上限')
                try:
                    event = json.loads(line)
                except ValueError:
                    event = {'type': 'output', 'stream': 'stderr', 'text': line[:2000]}
                if event.get('type') == 'result':
                    completed = True
                self.wfile.write((json.dumps(event) + '\n').encode())
                self.wfile.flush()
            process.wait(timeout=5)
            if not completed:
                self.wfile.write((json.dumps({'type': 'error', 'message': '运行已停止，或达到时间 / 内存限制'}) + '\n').encode())
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            try:
                self.wfile.write(b'{"type":"error","message":"Runtime output limit or service failure"}\n')
            except OSError:
                pass
        finally:
            if timer:
                timer.cancel()
            with LOCK:
                JOBS.pop(name, None)
            stop(name)
            if process:
                process.wait(timeout=10)
            SLOTS.release()


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8010), Handler).serve_forever()
