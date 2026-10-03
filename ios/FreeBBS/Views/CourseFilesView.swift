import SwiftUI
import QuickLook

struct CourseFile: Codable, Identifiable {
    let id: String
    let fileName: String
    let size: Int
    let url: String
}
struct FilesResponse: Codable { let files: [CourseFile] }
struct PreviewDocument: Identifiable { let id = UUID(); let url: URL }

struct CourseFilesView: View {
    @Environment(AppStore.self) private var store
    let course: Course
    @State private var files: [CourseFile] = []
    @State private var downloading: String?
    @State private var preview: PreviewDocument?
    @State private var temporaryDirectory: URL?
    @State private var loading = false
    var body: some View {
        List {
            if loading { ProgressView("正在加载资料…") }
            else if files.isEmpty { ContentUnavailableView("暂无课程资料", systemImage: "doc", description: Text("课程负责人上传后，资料会出现在这里。")) }
            ForEach(files) { file in
                Button { Task { await open(file) } } label: {
                    HStack(spacing: 14) {
                        Image(systemName: "doc.text").foregroundStyle(Palette.teal)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(file.fileName).foregroundStyle(.primary)
                            Text(ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if downloading == file.id { ProgressView() }
                        else { Image(systemName: "arrow.down").foregroundStyle(.secondary) }
                    }.frame(minHeight: 52)
                }.disabled(downloading != nil)
            }
            Section { Text("资料在系统预览中打开。关闭预览后会清除本次下载的临时文件。单次预览限 30 MB。").font(.footnote).foregroundStyle(.secondary) }
        }.navigationTitle("课程资料").navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .sheet(item: $preview, onDismiss: cleanUp) { item in DocumentPreview(url: item.url).ignoresSafeArea() }
            .onDisappear { if preview == nil { cleanUp() } }
    }
    private func load() async {
        guard !store.isDemo else { return }
        loading = true
        defer { loading = false }
        do {
            let response: FilesResponse = try await store.api.request("/api/course-upload/public/courses/\(course.slug)/files")
            files = response.files
        } catch { store.error = error.localizedDescription }
    }
    private func open(_ file: CourseFile) async {
        guard file.size > 0, file.size <= 30 * 1024 * 1024 else { store.error = "资料过大，请在网页端下载。"; return }
        guard let url = AppConfiguration.safeLink(file.url, origin: store.configuration.origin),
              url.host == store.configuration.origin.host, url.port == store.configuration.origin.port,
              url.path.hasPrefix("/api/course-upload/files/") else { store.error = "资料地址无效。"; return }
        downloading = file.id
        defer { downloading = nil }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForResource = 120
        let session = URLSession(configuration: config, delegate: SameOriginRedirectDelegate(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            let (temporary, response) = try await session.download(from: url)
            defer { try? FileManager.default.removeItem(at: temporary) }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw APIError.invalidResponse }
            cleanUp()
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("freebbs-" + UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            temporaryDirectory = directory
            let destination = directory.appendingPathComponent(URL(fileURLWithPath: file.fileName).lastPathComponent)
            try FileManager.default.moveItem(at: temporary, to: destination)
            preview = PreviewDocument(url: destination)
        } catch { cleanUp(); store.error = error.localizedDescription }
    }
    private func cleanUp() {
        if let directory = temporaryDirectory { try? FileManager.default.removeItem(at: directory) }
        temporaryDirectory = nil
    }
}
struct DocumentPreview: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }
    func updateUIViewController(_ controller: QLPreviewController, context: Context) { }
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem { url as NSURL }
    }
}
