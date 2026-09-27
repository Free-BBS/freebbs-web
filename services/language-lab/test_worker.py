import io
import json
from pathlib import Path
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from worker import vcd_waveforms
from trace_runner import value_repr
from controller import command


class WorkerTests(unittest.TestCase):
    def test_vcd_aliases_buses_and_unknowns(self):
        wave = vcd_waveforms('''$timescale 1 ps $end
$scope module tb $end
$var wire 1 ! clk $end
$var wire 1 ! alias $end
$var reg 4 # counter [3:0] $end
$upscope $end
$enddefinitions $end
#0
0!
bxxxx #
#5
1!
b1010 #
#10
z!
''')
        self.assertEqual(wave['timescale'], '1ps')
        self.assertEqual(wave['end'], 10)
        self.assertEqual(wave['signals'][0]['values'], wave['signals'][1]['values'])
        self.assertEqual(wave['signals'][2]['values'], [[0, 'xxxx'], [5, '1010']])

    def test_repr_never_invokes_user_code(self):
        class Malicious:
            def __repr__(self):
                raise AssertionError('must not run')
        self.assertEqual(value_repr(Malicious()), '<Malicious>')
        self.assertIn('<Malicious>', value_repr([Malicious()]))
        self.assertLess(len(value_repr(list(range(100000)))), 600)

    def test_container_has_no_host_mounts_or_network(self):
        args = command('test')
        for required in ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534', '--pids-limit=64', '--memory=512m']:
            self.assertIn(required, args)
        self.assertNotIn('-v', args)
        self.assertNotIn('--privileged', args)

    def test_python_real_pause_step_scope_types_and_stdout(self):
        with tempfile.TemporaryDirectory(prefix='lab-test-') as root:
            Path(root, 'main.py').write_text('x = 2\ndef double(n):\n    y = n * 2\n    return y\nz = double(x)\nprint(z)\n')
            Path(root, 'request.json').write_text(json.dumps({'interval': 0, 'paused': True}))
            child = subprocess.Popen([sys.executable, '-u', str(Path(__file__).with_name('trace_runner.py'))], env={**os.environ, 'LAB_TRACE_ROOT': root}, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            events = queue.Queue()
            thread = threading.Thread(target=lambda: [events.put(json.loads(line)) for line in child.stdout], daemon=True)
            thread.start()
            try:
                first = events.get(timeout=3)
                self.assertEqual(first['line'], 1)
                time.sleep(.1)
                self.assertTrue(events.empty())
                child.stdin.write('{"action":"step"}\n'); child.stdin.flush()
                second = events.get(timeout=3)
                self.assertEqual(second['line'], 2)
                self.assertEqual(second['variables'][0]['value'], '2')
                time.sleep(.1)
                self.assertTrue(events.empty())
                child.stdin.write('{"action":"resume"}\n'); child.stdin.flush()
                child.wait(timeout=3); thread.join(timeout=1)
                remaining = list(events.queue)
                self.assertTrue(any(e.get('function') == 'double' and any(v['name'] == 'y' and v['value'] == '4' and v['type'] == 'int' for v in e['variables']) for e in remaining if e['type'] == 'trace'))
                self.assertTrue(any(e.get('text') == '4' for e in remaining))
                self.assertEqual(remaining[-1]['exitCode'], 0)
            finally:
                if child.poll() is None:
                    child.kill()
                child.communicate()

    def test_python_actual_line_interval(self):
        with tempfile.TemporaryDirectory(prefix='lab-timing-') as root:
            Path(root, 'main.py').write_text('x = 1\ny = x + 2\n')
            Path(root, 'request.json').write_text(json.dumps({'interval': .1}))
            start = time.monotonic()
            completed = subprocess.run([sys.executable, '-u', str(Path(__file__).with_name('trace_runner.py'))], env={**os.environ, 'LAB_TRACE_ROOT': root}, capture_output=True, text=True, timeout=3)
            self.assertGreaterEqual(time.monotonic() - start, .19)
            events = [json.loads(line) for line in completed.stdout.splitlines()]
            self.assertEqual(events[-2]['variables'][-1]['value'], '3')
            self.assertEqual(events[-1]['exitCode'], 0)


if __name__ == '__main__':
    unittest.main()
