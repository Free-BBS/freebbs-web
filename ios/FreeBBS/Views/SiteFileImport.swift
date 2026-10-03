import SwiftUI
import PhotosUI
import CoreTransferable
import UniformTypeIdentifiers

nonisolated struct SitePhotoUpload: Transferable, Sendable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .item) { received in
            let directory = try SiteImports.directory()
            let target = directory.appendingPathComponent(received.file.lastPathComponent)
            do { try FileManager.default.copyItem(at: received.file, to: target) }
            catch { SiteImports.discard([directory]); throw error }
            return SitePhotoUpload(url: target)
        }
    }
}

private struct SiteFileImport: ViewModifier {
    @Bindable var browser: LabBrowserState
    @State private var photos: [PhotosPickerItem] = []
    func body(content: Content) -> some View {
        content
            .confirmationDialog("选择上传来源", isPresented: $browser.presentingUploadChoices, titleVisibility: .visible) {
                Button("照片与视频") { photos = []; browser.presentingPhotos = true }
                Button("文件") { browser.presentingFiles = true }
                Button("取消", role: .cancel) { browser.resolveFiles(nil) }
            }
            .fileImporter(isPresented: $browser.presentingFiles, allowedContentTypes: browser.directoryUpload ? [.folder] : [.item], allowsMultipleSelection: browser.multipleFiles) { result in
                switch result {
                case .success(let urls): browser.importFiles(urls)
                case .failure: browser.resolveFiles(nil)
                }
            }
            .photosPicker(isPresented: $browser.presentingPhotos, selection: $photos,
                          maxSelectionCount: browser.multipleFiles ? nil : 1, matching: .any(of: [.images, .videos]))
            .onChange(of: photos) { _, selected in
                guard !selected.isEmpty else { return }
                let revision = browser.fileRevision
                Task {
                    var urls: [URL] = []
                    do {
                        for item in selected {
                            guard let upload = try await item.loadTransferable(type: SitePhotoUpload.self) else { throw CocoaError(.fileReadUnknown) }
                            urls.append(upload.url)
                        }
                        guard browser.fileRevision == revision else { SiteImports.discard(urls); return }
                        browser.resolveFiles(urls)
                    } catch {
                        SiteImports.discard(urls)
                        guard browser.fileRevision == revision else { return }
                        browser.downloadError = error.localizedDescription; browser.resolveFiles(nil)
                    }
                }
            }
            .onChange(of: browser.presentingPhotos) { _, visible in
                guard !visible else { return }
                let revision = browser.fileRevision
                Task {
                    try? await Task.sleep(for: .milliseconds(150))
                    if photos.isEmpty && browser.fileRevision == revision { browser.resolveFiles(nil) }
                }
            }
    }
}

extension View {
    func siteFileImport(browser: LabBrowserState) -> some View { modifier(SiteFileImport(browser: browser)) }
}
