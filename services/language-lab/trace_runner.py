"""Runs only inside the disposable, networkless lab container, never on the host."""
import builtins
import io
import json
import os
import sys
import threading
import time
import traceback
import types

wire = sys.stdout
lock = threading.Lock()
condition = threading.Condition()
control = {'paused': False, 'steps': 0, 'interval': 1.0}
TRACE_ROOT = os.environ.get('LAB_TRACE_ROOT', '/tmp')
SOURCE_PATH = TRACE_ROOT + '/main.py'
count = 0
output_bytes = 0


def emit(event):
    with lock:
        wire.write(json.dumps(event, ensure_ascii=True) + '\n')
        wire.flush()


def controls():
    for line in sys.__stdin__:
        try:
            message = json.loads(line)
            with condition:
                action = message.get('action')
                if action == 'pause':
                    control['paused'] = True
                elif action == 'resume':
                    control['paused'] = False
                elif action == 'step':
                    control['paused'] = True
                    control['steps'] += 1
                elif action == 'speed':
                    control['interval'] = min(5, max(0, float(message['interval'])))
                condition.notify_all()
        except (ValueError, KeyError, TypeError):
            pass


def value_repr(value, depth=0):
    # Never invoke user-defined __repr__, descriptors or properties while observing.
    kind = type(value)
    if kind in (int, float, bool, str, bytes, type(None), complex):
        if kind is str or kind is bytes:
            return repr(value[:250]) + ('…' if len(value) > 250 else '')
        try:
            return repr(value)[:300]
        except ValueError:
            return '<large integer>'
    if depth < 2 and kind in (list, tuple, dict, set, frozenset):
        if kind is dict:
            items = [f'{value_repr(k, depth+1)}: {value_repr(v, depth+1)}'
                     for k, v in __import__('itertools').islice(value.items(), 12)]
            return '{' + ', '.join(items)[:500] + (' …' if len(value) > 12 else '') + '}'
        items = []
        for item in value:
            if len(items) == 12:
                break
            items.append(value_repr(item, depth+1))
        left, right = ('[', ']') if kind is list else ('(', ')') if kind is tuple else ('{', '}')
        return left + ', '.join(items)[:500] + (' …' if len(value) > 12 else '') + right
    return '<' + type.__getattribute__(kind, '__name__')[:80] + '>'


def variables(frame):
    result = []
    for scope, values in [('global', frame.f_globals), ('local', frame.f_locals)]:
        if scope == 'global' and frame.f_globals is frame.f_locals:
            continue
        for name, value in list(values.items())[:150]:
            if name.startswith('__') or isinstance(value, (types.ModuleType, types.FunctionType, type)):
                continue
            result.append({'name': name[:100], 'type': type.__getattribute__(type(value), '__name__')[:80],
                           'value': value_repr(value), 'scope': scope})
    return result[:100]


def trace(frame, event, arg):
    global count
    if frame.f_code.co_filename != SOURCE_PATH:
        return None
    if event not in ('line', 'return', 'exception'):
        return trace
    count += 1
    if count > 1500:
        raise RuntimeError('逐行观察已达到 1500 步上限，请缩小实验规模')
    payload = {'type': 'trace', 'line': frame.f_lineno, 'event': event,
               'function': frame.f_code.co_name, 'variables': variables(frame), 'step': count}
    if event == 'return':
        payload['returnValue'] = value_repr(arg)
    if event == 'exception':
        payload['exception'] = type.__getattribute__(arg[0], '__name__')
    emit(payload)
    if event == 'line':
        with condition:
            started = time.monotonic()
            while True:
                if control['steps']:
                    control['steps'] -= 1
                    break
                if control['paused']:
                    condition.wait(0.2)
                    started = time.monotonic()
                else:
                    remaining = control['interval'] - (time.monotonic() - started)
                    if remaining <= 0:
                        break
                    condition.wait(min(remaining, 0.2))
    return trace


class Output(io.TextIOBase):
    def __init__(self, stream):
        self.stream = stream

    def write(self, value):
        global output_bytes
        value = str(value)
        output_bytes += len(value.encode('utf8'))
        if output_bytes > 64000:
            raise RuntimeError('输出超过 64 KB 上限')
        if value:
            emit({'type': 'output', 'stream': self.stream, 'text': value})
        return len(value)

    def flush(self):
        pass


if __name__ == '__main__':
    settings = json.loads(open(TRACE_ROOT + '/request.json').read())
    control['interval'] = settings.get('interval', 1)
    control['paused'] = settings.get('paused', False)
    threading.Thread(target=controls, daemon=True).start()
    sys.stdin = io.StringIO(settings.get('stdin', ''))
    sys.stdout, sys.stderr = Output('stdout'), Output('stderr')
    namespace = {'__name__': '__main__', '__builtins__': builtins}
    exit_code = 0
    try:
        code = compile(open(SOURCE_PATH).read(), SOURCE_PATH, 'exec')
        sys.settrace(trace)
        exec(code, namespace, namespace)
    except SystemExit as error:
        exit_code = error.code if isinstance(error.code, int) else (0 if error.code is None else 1)
    except BaseException:
        sys.settrace(None)
        exit_code = 1
        emit({'type': 'output', 'stream': 'stderr', 'text': traceback.format_exc()[-8000:]})
    finally:
        sys.settrace(None)
        emit({'type': 'result', 'exitCode': exit_code})
