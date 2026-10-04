import Foundation
import Observation

enum CodeLanguage: String, CaseIterable, Identifiable {
    case c, cpp, python, matlab, verilog
    var id: String { rawValue }
    var name: String { switch self { case .c: "C"; case .cpp: "C++"; case .python: "Python"; case .matlab: "Octave"; case .verilog: "Verilog" } }
    var symbol: String { switch self { case .c, .cpp: "curlybraces"; case .python: "terminal"; case .matlab: "waveform.path"; case .verilog: "waveform" } }
    var fileExtension: String { switch self { case .c: "c"; case .cpp: "cpp"; case .python: "py"; case .matlab: "m"; case .verilog: "v" } }
    var example: String {
        switch self {
        case .c: "#include <stdio.h>\nint square(int x) { return x * x; }\nint main(void) { printf(\"%d\\n\", square(7)); return 0; }\n"
        case .cpp: "#include <iostream>\nint main() {\n    int total = 0;\n    for (int i = 1; i <= 5; ++i) total += i * i;\n    std::cout << total << \"\\n\";\n}\n"
        case .python: "numbers = [2, 4, 6, 8]\ntotal = 0\nfor index, value in enumerate(numbers):\n    total += value\n    average = total / (index + 1)\n    print(index, total, average)\nprint(\"最终结果:\", total)\n"
        case .matlab: "t = 0:0.01:5;\ny = exp(-0.6*t).*sin(2*pi*t);\nfigure;\nplot(t,y); grid on;\nxlabel('Time (s)'); ylabel('Amplitude');\ntitle('Damped oscillation');\ndisp(length(t));\n"
        case .verilog: "`timescale 1ns/1ps\nmodule testbench;\n  reg clk = 0;\n  reg reset = 1;\n  reg [3:0] count = 0;\n  always #5 clk = ~clk;\n  always @(posedge clk) begin\n    if (reset) count <= 0;\n    else count <= count + 1;\n  end\n  initial begin\n    #12 reset = 0;\n    #150;\n    $display(\"count = %d\", count);\n    $finish;\n  end\nendmodule\n"
        }
    }
}
struct LabCapabilities: Decodable { let ready: Bool }
struct LabAssembly: Decodable { let text: String?; let error: String? }
struct LabVariable: Decodable, Identifiable {
    let name: String; let type: String; let value: String; let scope: String?
    var id: String { (scope ?? "") + ":" + name }
}
struct LabTrace: Decodable { let line: Int?; let step: Int?; let function: String?; let variables: [LabVariable]? }
enum WaveScalar: Decodable {
    case number(Double), text(String)
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if let number = try? value.decode(Double.self), number.isFinite { self = .number(number) }
        else { self = .text(try value.decode(String.self)) }
    }
    var number: Double? { if case .number(let value) = self { value } else { nil } }
    var text: String { switch self { case .number(let value): String(value); case .text(let value): value } }
}
struct LabWaveform: Decodable {
    struct Signal: Decodable, Identifiable {
        let name: String; let width: Int; let values: [[WaveScalar]]
        var id: String { name }
        var transitions: [(Double, String)] { values.prefix(2000).compactMap { value in
            guard value.count == 2, let time = value[0].number, time >= 0 else { return nil }
            return (time, value[1].text)
        } }
    }
    let end: Double; let timescale: String; let signals: [Signal]
}
struct LabOutput: Decodable {
    let exitCode: Int?; let stdout: String?; let stderr: String?
    let assembly: [String: LabAssembly]?; let figures: [String]?
    let waveform: LabWaveform?; let lastTrace: LabTrace?
}
struct SavedExperiment: Decodable {
    let id: String; let title: String; let language: String; let source: String
    let stdin: String?; let optimization: String?; let interval: Double?; let result: LabOutput?
}
struct ExperimentResponse: Decodable { let experiment: SavedExperiment }

@MainActor @Observable final class CodeLaboratory {
    nonisolated deinit {}
    var language: CodeLanguage
    var title: String
    var source: String
    var stdin = ""
    var optimization = "0"
    var interval = 1.0
    var ready = false
    var running = false
    var paused = false
    var status = "准备实验环境…"
    var error: String?
    var console = ""
    var trace: LabTrace?
    var output: LabOutput?
    var activeID: String?
    var savedRunID: String?
    private var resultInput: Data?
    init(language: CodeLanguage) { self.language = language; title = language.name + " 实验"; source = language.example }
    var input: [String: Any] { ["language":language.rawValue, "source":source, "stdin":stdin, "optimization":optimization, "interval":interval] }
    func reset(_ next: CodeLanguage) {
        guard !running else { return }
        language = next; title = next.name + " 实验"; source = next.example; stdin = ""
        output = nil; trace = nil; console = ""; savedRunID = nil; error = nil
    }
    func accept(_ data: Data) throws {
        let event = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        switch event["type"] as? String {
        case "started": activeID = event["id"] as? String; status = paused ? "已暂停" : "正在运行"
        case "status": status = event["message"] as? String ?? status
        case "output": console = String((console + (event["text"] as? String ?? "")).suffix(64000))
        case "trace": trace = try JSONDecoder().decode(LabTrace.self, from: data)
        case "result":
            output = try JSONDecoder().decode(LabOutput.self, from: data)
            console = String(([output?.stdout ?? console, output?.stderr ?? ""].filter { !$0.isEmpty }.joined(separator: "\n")).suffix(64000))
            status = "运行结束 · 退出码 \(output?.exitCode ?? -1)"
        case "saved-run": savedRunID = event["id"] as? String
        case "error": error = event["message"] as? String ?? "实验运行失败"
        default: break
        }
    }
    func run(api: APIClient, singleStep: Bool = false) async {
        guard !running, source.utf8.count <= 64000 else { return }
        running = true; paused = singleStep; output = nil; trace = nil; console = ""; savedRunID = nil; error = nil
        resultInput = try? JSONSerialization.data(withJSONObject: input, options: .sortedKeys)
        defer { running = false; activeID = nil }
        do {
            var payload = input; payload["paused"] = singleStep
            try await api.stream("/api/labs/run", body: payload) { try self.accept($0) }
        } catch is CancellationError { status = "实验已停止" }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    func control(_ action: String, api: APIClient) async {
        guard let id = activeID else { return }
        do {
            let _: MessageResponse = try await api.request("/api/labs/runs/\(id)/control", method: "POST", body: ["action":action,"interval":interval])
            if action == "pause" || action == "step" { paused = true }
            if action == "resume" { paused = false }
            if action == "speed" { resultInput = try JSONSerialization.data(withJSONObject: input, options: .sortedKeys) }
        } catch { self.error = error.localizedDescription }
    }
    func snapshot(api: APIClient) async throws -> DiscussionDraft {
        var payload = input; payload["title"] = title
        let current = try JSONSerialization.data(withJSONObject: input, options: .sortedKeys)
        if current == resultInput, let savedRunID { payload["runId"] = savedRunID }
        let response: ExperimentResponse = try await api.request("/api/labs/experiments", method: "POST", body: payload)
        var link = URLComponents(url: api.origin, resolvingAgainstBaseURL: false)!
        link.path = "/code-lab"; link.queryItems = [.init(name: "experiment", value: response.experiment.id)]
        guard let url = link.url else { throw APIError.invalidURL }
        return DiscussionDraft(title: "\(language.name) 实验：\(title)".prefix(120).description,
                               content: "[查看实验代码与结果](\(url.absoluteString))\n\n我的观察：\n", board: "daily")
    }
}
