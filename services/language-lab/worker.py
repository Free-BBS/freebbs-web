"""Fixed compiler commands and result collection inside a disposable container."""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys

LIMIT = 64000


def emit(event):
    print(json.dumps(event, ensure_ascii=True), flush=True)


def run(command, stdin='', timeout=25):
    # Files bound output memory; the container tmpfs and controller impose hard limits.
    with open('/tmp/stdout', 'w+') as out, open('/tmp/stderr', 'w+') as err:
        try:
            process = subprocess.run(command, input=stdin, text=True, stdout=out, stderr=err,
                                     timeout=timeout, cwd='/tmp')
            code = process.returncode
        except subprocess.TimeoutExpired:
            code = 124
        out.seek(0)
        err.seek(0)
        stdout, stderr = out.read(LIMIT), err.read(LIMIT)
        if code == 124:
            stderr += '\n运行超过时限（25 秒）'
        return {'stdout': stdout, 'stderr': stderr, 'exitCode': code}


def vcd_waveforms(text):
    signals, codes, scope = [], {}, []
    now, timescale, definitions, maximum = 0, '1ns', True, 0
    scale = re.search(r'\$timescale\s+([^$]+)\$end', text)
    if scale:
        timescale = re.sub(r'\s+', '', scale.group(1))[:30]
    for line in text.splitlines():
        line = line.strip()
        if definitions:
            fields = line.split()
            if line.startswith('$scope') and len(fields) >= 3:
                scope.append(fields[2])
            elif line.startswith('$upscope') and scope:
                scope.pop()
            elif line.startswith('$var') and len(fields) >= 6 and len(signals) < 40:
                signal = {'name': '.'.join(scope + [fields[4]])[:160],
                          'width': min(1024, int(fields[2])), 'values': []}
                signals.append(signal)
                codes.setdefault(fields[3], []).append(signal)
            elif '$enddefinitions' in line:
                definitions = False
            continue
        if line.startswith('#'):
            now = int(line[1:])
            maximum = max(maximum, now)
        elif line and line[0].lower() in '01xzbr':
            if line[0].lower() in 'br':
                parts = line[1:].split()
                if len(parts) != 2:
                    continue
                value, code = parts
            else:
                value, code = line[0], line[1:]
            for signal in codes.get(code, []):
                if len(signal['values']) < 2000:
                    signal['values'].append([now, value[:1024]])
    return {'kind': 'digital', 'timescale': timescale, 'end': maximum, 'signals': signals}


def main():
    # Do not prefetch control messages: Python replaces this process after reading the request.
    request = json.loads(sys.stdin.buffer.raw.readline())
    language, source = request['language'], request['source']
    stdin = request.get('stdin', '')
    if language == 'python':
        Path('/tmp/main.py').write_text(source)
        Path('/tmp/request.json').write_text(json.dumps(request))
        os.execv(sys.executable, [sys.executable, '-u', '/opt/lab/trace_runner.py'])
    if language in ('c', 'cpp'):
        filename = 'main.c' if language == 'c' else 'main.cpp'
        Path(filename).write_text(source)
        compiler = 'gcc' if language == 'c' else 'g++'
        standard = '-std=c17' if language == 'c' else '-std=c++17'
        optimization = '-O' + request.get('optimization', '0')
        assembly = {}
        for arch, prefix in [('x86', ''), ('mips', 'mips-linux-gnu-'), ('riscv', 'riscv64-linux-gnu-')]:
            emit({'type': 'status', 'message': '正在编译 ' + arch + ' 汇编…'})
            result = run([prefix + compiler, standard, optimization, '-g', '-S', '-fverbose-asm',
                          filename, '-o', arch + '.s'] + (['-masm=intel'] if arch == 'x86' else []))
            assembly[arch] = {'text': Path(arch + '.s').read_text()[:120000] if result['exitCode'] == 0 else '',
                              'error': result['stderr'], 'exitCode': result['exitCode']}
        compiled = run([compiler, standard, optimization, filename, '-o', '/tmp/program', '-lm'])
        executed = run(['/tmp/program'], stdin) if compiled['exitCode'] == 0 else compiled
        if compiled['exitCode'] == 0:
            executed['stderr'] = compiled['stderr'] + executed['stderr']
        emit({'type': 'result', **executed, 'assembly': assembly, 'runtime': 'GCC · x86-64 / MIPS32 / RISC-V64'})
    elif language == 'matlab':
        Path('main.m').write_text(source)
        # Preserve actual Octave plots, including subplots, labels and multiple figures.
        wrapper = """warning('off','Octave:gnuplot-graphics');
set(0, 'defaultfigurevisible', 'off');
set(0, 'defaultfigureposition', [100, 100, 900, 700]);
set(0, 'defaultfigurepaperpositionmode', 'auto');
set(0, 'defaultaxesfontsize', 10);
graphics_toolkit('gnuplot');
try
  run('/tmp/main.m');
catch err
  fprintf(2, '%s\\n', err.message);
  exit(1);
end
figures = findall(0, 'type', 'figure');
for k = 1:min(numel(figures), 6)
  print(figures(k), sprintf('/tmp/figure-%d.png', k), '-dpng', '-r90');
end
"""
        Path('capture.m').write_text(wrapper)
        result = run(['octave', '--no-gui', '--quiet', '--no-history', '/tmp/capture.m'], stdin)
        figures = []
        for file in sorted(Path('/tmp').glob('figure-*.png'))[:6]:
            if file.stat().st_size <= 240000:
                figures.append('data:image/png;base64,' + base64.b64encode(file.read_bytes()).decode())
        emit({'type': 'result', **result, 'figures': figures, 'runtime': 'GNU Octave（MATLAB 兼容语法）'})
    elif language == 'verilog':
        Path('main.v').write_text(source)
        # An additional root module records all simulation scopes without modifying the design.
        Path('capture.v').write_text('module freebbs_wave_capture; initial begin $dumpfile("/tmp/wave.vcd"); $dumpvars; end endmodule\n')
        result = run(['iverilog', '-g2012', '-o', '/tmp/simulation', 'main.v', 'capture.v'])
        if result['exitCode'] == 0:
            result = run(['vvp', '/tmp/simulation'], stdin)
        files = [Path('/tmp/wave.vcd')] + list(Path('/tmp').glob('*.vcd'))
        waveform = None
        for file in files:
            if file.exists() and file.stat().st_size <= 8 * 1024 * 1024:
                waveform = vcd_waveforms(file.read_text(errors='replace'))
                if waveform['signals']:
                    break
        emit({'type': 'result', **result, 'waveform': waveform, 'runtime': 'Icarus Verilog · SystemVerilog 2012'})
    else:
        raise ValueError('Unsupported language')


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        emit({'type': 'error', 'message': str(error)[:2000]})
        sys.exit(1)
