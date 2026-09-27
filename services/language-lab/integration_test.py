"""Opt-in integration against the loopback broker; creates only disposable containers."""
import json
import os
import queue
import threading
import time
import unittest
import urllib.request
import uuid

BASE = os.environ.get('LAB_TEST_URL', 'http://127.0.0.1:8010')


def request(route, body):
    return urllib.request.urlopen(urllib.request.Request(BASE + route, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'}), timeout=195)


def execute(language, source, **options):
    with request('/run', {'id': 'lab-' + uuid.uuid4().hex, 'language': language, 'source': source, 'interval': 0, **options}) as response:
        events = [json.loads(line) for line in response]
    results = [event for event in events if event['type'] == 'result']
    if not results:
        raise AssertionError(events[-5:])
    return results[-1], events


class RuntimeTests(unittest.TestCase):
    def test_c_and_cpp_all_architectures_and_stdin(self):
        for language, source in [
            ('c', '#include <stdio.h>\nint sq(int n){return n*n;}\nint main(){int n;scanf("%d", &n);printf("%d\\n",sq(n));}'),
            ('cpp', '#include <iostream>\n#include <vector>\nint main(){std::vector<int> x={1,2,3}; std::cout << x.size() << "\\n";}'),
        ]:
            with self.subTest(language=language):
                result, _ = execute(language, source, stdin='7\n', optimization='2')
                self.assertEqual(result['exitCode'], 0, result.get('stderr'))
                self.assertEqual(result['stdout'].strip(), '49' if language == 'c' else '3')
                for arch in ('x86', 'mips', 'riscv'):
                    self.assertEqual(result['assembly'][arch]['exitCode'], 0, result['assembly'][arch]['error'])
                    self.assertIn('main', result['assembly'][arch]['text'])

    def test_compile_error_is_reported(self):
        result, _ = execute('cpp', 'int main( invalid')
        self.assertNotEqual(result['exitCode'], 0)
        self.assertIn('error:', result['stderr'])

    def test_matlab_real_multi_subplot_png(self):
        result, _ = execute('matlab', "t=0:0.01:1; y=sin(2*pi*t); figure; subplot(2,1,1);plot(t,y);title('Sine'); subplot(2,1,2);plot(t,cos(2*pi*t)); figure;plot(t,y.*exp(-t)); disp(length(t));")
        self.assertEqual(result['exitCode'], 0, result.get('stderr'))
        self.assertIn('101', result['stdout'])
        self.assertEqual(len(result['figures']), 2, result.get('stderr'))
        self.assertTrue(all(image.startswith('data:image/png;base64,iVBOR') for image in result['figures']))

    def test_verilog_real_edges_and_bus(self):
        result, _ = execute('verilog', '`timescale 1ns/1ps\nmodule tb; reg clk=0; reg [3:0] count=0; always #5 clk=~clk; always @(posedge clk) count<=count+1; initial begin #42; $finish; end endmodule')
        self.assertEqual(result['exitCode'], 0, result.get('stderr'))
        wave = result['waveform']; self.assertEqual(wave['timescale'], '1ps')
        clock = next(signal for signal in wave['signals'] if signal['name'] == 'tb.clk')
        self.assertIn([5000, '1'], clock['values'])
        self.assertTrue(any(signal['width'] == 4 for signal in wave['signals']))

    def test_python_timing_controls_and_types(self):
        run_id = 'lab-' + uuid.uuid4().hex
        response = request('/run', {'id': run_id, 'language': 'python', 'source': 'x=2\ny=x/2\nprint(y)\n', 'interval': 1, 'paused': True})
        events = queue.Queue()
        thread = threading.Thread(target=lambda: [events.put(json.loads(line)) for line in response], daemon=True)
        thread.start()
        try:
            first = events.get(timeout=10); self.assertEqual(first['line'], 1)
            time.sleep(.2); self.assertTrue(events.empty())
            with request('/control/' + run_id, {'action': 'step'}) as reply: self.assertEqual(reply.status, 200)
            second = events.get(timeout=5); self.assertEqual(second['variables'][0]['value'], '2')
            time.sleep(.2); self.assertTrue(events.empty())
            with request('/control/' + run_id, {'action': 'speed', 'interval': .1}): pass
            started = time.monotonic()
            with request('/control/' + run_id, {'action': 'resume'}): pass
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive())
            self.assertGreaterEqual(time.monotonic() - started, .18)
            remaining = list(events.queue)
            self.assertTrue(any(v['name'] == 'y' and v['type'] == 'float' and v['value'] == '1.0' for e in remaining if e['type'] == 'trace' for v in e['variables']))
            self.assertTrue(any(e.get('exitCode') == 0 for e in remaining))
        finally:
            response.close()

    def test_sandbox_is_readonly_networkless_nonroot(self):
        result, events = execute('python', "import os, socket\nprint('UID',os.getuid())\ntry:\n    open('/etc/lab-test-write','w')\nexcept OSError:\n    print('READONLY')\ntry:\n    socket.create_connection(('1.1.1.1',80),timeout=1)\nexcept OSError:\n    print('NO_NETWORK')\n")
        self.assertEqual(result['exitCode'], 0)
        output = ''.join(event.get('text', '') for event in events)
        for expected in ('65534', 'READONLY', 'NO_NETWORK'): self.assertIn(expected, output)

    def test_stop_sleeping_session(self):
        run_id = 'lab-' + uuid.uuid4().hex
        response = request('/run', {'id': run_id, 'language': 'python', 'source': 'x=1', 'interval': 1, 'paused': True})
        self.assertEqual(json.loads(response.readline())['type'], 'trace')
        with request('/control/' + run_id, {'action': 'stop'}) as reply: self.assertEqual(reply.status, 200)
        self.assertIn('error', response.read().decode())
        response.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
