import SwiftUI
import UIKit

struct NativeMaxAttachmentsView: View {
    let metadata: [String: SiteRecord]
    var body: some View {
        ForEach(Array((metadata["images"]?.list ?? []).enumerated()), id: \.offset) { _, item in
            if let source = item["dataUrl"].text.split(separator: ",", maxSplits: 1).last, item["dataUrl"].text.hasPrefix("data:image/"), let data = Data(base64Encoded: String(source)), data.count <= 1024 * 1024, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 220).clipShape(RoundedRectangle(cornerRadius: 16)).accessibilityLabel(item["label"].text)
            }
        }
        ForEach(Array((metadata["documents"]?.list ?? []).enumerated()), id: \.offset) { _, item in
            NavigationLink { NativeMaxDocumentPages(document: item) } label: { Label(item["name"].text + " · " + item["pageCount"].text + " 页", systemImage: "doc.richtext") }
        }
        ForEach(Array((metadata["generated_images"]?.list ?? []).enumerated()), id: \.offset) { _, item in
            NativeGeneratedMaxImage(record: item)
        }
        ForEach(Array((metadata["navigation"]?["routes"].list ?? []).enumerated()), id: \.offset) { _, item in NativeMaxRoute(record: item) }
    }
}
struct NativeMaxRoute: View {
    @Environment(AppStore.self) private var store
    let record: SiteRecord
    var body: some View {
        if let url = AppConfiguration.safeLink(record["url"].text.isEmpty ? record["href"].text : record["url"].text, origin: store.configuration.origin), let destination = FeatureDestination(url: url, origin: store.configuration.origin) { NavigationLink(record["title"].text.isEmpty ? destination.title : record["title"].text) { FeatureWorkspaceView(destination: destination) } }
    }
}
struct NativeGeneratedMaxImage: View {
    @Environment(AppStore.self) private var store
    let record: SiteRecord
    var body: some View {
        if let url = AppConfiguration.safeLink(record["url"].text, origin: store.configuration.origin), WebContentPolicy.sameOrigin(url, origin: store.configuration.origin) {
            AsyncImage(url: url) { image in image.resizable().scaledToFit() } placeholder: { ProgressView() }.frame(maxHeight: 300)
            ShareLink(item: url) { Label("分享图片", systemImage: "square.and.arrow.up") }
        }
    }
}
struct NativeMaxDocumentPages: View {
    @Environment(AppStore.self) private var store
    let document: SiteRecord
    @State private var state = NativeWorkspace()
    @State private var start = 1
    var body: some View {
        List {
            WorkspaceStatus(state: state)
            Text(document["name"].text).font(.headline)
            ForEach(Array(state.data["pages"].list.enumerated()), id: \.offset) { _, page in
                NativeMaxAttachmentsView(metadata: ["images": .array([page])])
            }
            HStack { Button("上一组") { start = max(1, start - 4) }.frame(minHeight: 44).disabled(start <= 1); Spacer(); Text("\(start) – \(min(start + 3, document["pageCount"].int)) 页").font(.caption); Spacer(); Button("下一组") { start += 4 }.frame(minHeight: 44).disabled(start + 4 > document["pageCount"].int) }.buttonStyle(.borderless).disabled(state.loading)
        }.navigationTitle("文档预览").navigationBarTitleDisplayMode(.inline)
        .task(id: "\(store.sessionRevision)-\(start)") { await state.load(store, path: "/api/ai/files/" + NativeRoutes.component(document["id"].text) + "/pages", query: [.init(name: "start", value: String(start)), .init(name: "count", value: "4")]) }
    }
}
