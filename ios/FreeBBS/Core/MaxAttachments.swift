import Foundation
import Observation
import UIKit

@MainActor @Observable
final class MaxAttachments {
    nonisolated deinit {}
    var images: [SiteRecord] = []
    var documents: [SiteRecord] = []
    var textFiles: [MaxTextFile] = []
    var error: String?
    var progress = 0.0
    var busy = false
    var task: Task<Void, Never>?
    var context: String { textFiles.map { "\n\n[附件：\($0.name)]\n\($0.text)" }.joined() }
    func reset() { task?.cancel(); task = nil; images = []; documents = []; textFiles = []; error = nil; busy = false; progress = 0 }
    func addImage(_ data: Data) {
        guard images.count < 4, data.count <= 20 * 1024 * 1024, let image = UIImage(data: data), image.size.width >= 32, image.size.height >= 32 else { error = "最多添加 4 张图片，请选择有效图片。"; return }
        let ratio = min(1, 2048 / max(image.size.width, image.size.height))
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: image.size.width * ratio, height: image.size.height * ratio), format: format)
        let reduced = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: CGSize(width: image.size.width * ratio, height: image.size.height * ratio))) }
        var quality = 0.8
        var jpeg = reduced.jpegData(compressionQuality: quality)
        while (jpeg?.count ?? 0) > 1024 * 1024 && quality > 0.15 { quality -= 0.15; jpeg = reduced.jpegData(compressionQuality: quality) }
        guard let jpeg, jpeg.count <= 1024 * 1024 else { error = "图片压缩后仍过大，请选择较小图片。"; return }
        images.append(.object(["label": .string("图片 \(images.count + 1)"), "dataUrl": .string("data:image/jpeg;base64," + jpeg.base64EncodedString())])); error = nil
    }
    func addFile(_ url: URL, store: AppStore) async {
        guard store.requireLogin(), store.aiConsent else { error = "请先同意 Max 数据使用。"; return }
        guard !busy, documents.count + textFiles.count < 4, !store.isDemo else { error = "最多添加 4 个文件；预览模式不会上传文件。"; return }
        let scope = url.startAccessingSecurityScopedResource(); defer { if scope { url.stopAccessingSecurityScopedResource() } }
        busy = true; progress = 0; error = nil; let session = store.sessionRevision
        defer { if session == store.sessionRevision { busy = false } }
        do {
            let result = try await store.api.parseMaxFile(url) { self.progress = $0 }
            try Task.checkCancellation(); guard session == store.sessionRevision, store.aiConsent else { return }
            if !result["document"]["id"].text.isEmpty { documents.append(result["document"]) }
            else { textFiles.append(.init(name: result["name"].text, text: result["text"].text)) }
        } catch { if !Task.isCancelled, session == store.sessionRevision { self.error = error.localizedDescription } }
    }
}
struct MaxTextFile: Identifiable { let id = UUID(); let name: String; let text: String }
