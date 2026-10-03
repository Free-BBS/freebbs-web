import Foundation

nonisolated enum SiteImports {
    static func directory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("FeatureImport-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
    static func discard(_ urls: [URL]) {
        let root = FileManager.default.temporaryDirectory.standardizedFileURL
        for url in urls {
            guard url.isFileURL else { continue }
            let relative = url.standardizedFileURL.pathComponents.dropFirst(root.pathComponents.count)
            guard url.standardizedFileURL.pathComponents.starts(with: root.pathComponents), let first = relative.first,
                  first.hasPrefix("FeatureImport-"), UUID(uuidString: String(first.dropFirst("FeatureImport-".count))) != nil else { continue }
            try? FileManager.default.removeItem(at: root.appendingPathComponent(first, isDirectory: true))
        }
    }
    static func purgeExpired(now: Date = .now) {
        let root = FileManager.default.temporaryDirectory
        let children = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.creationDateKey, .isDirectoryKey, .isSymbolicLinkKey])) ?? []
        for child in children {
            guard child.lastPathComponent.hasPrefix("FeatureImport-"),
                  UUID(uuidString: String(child.lastPathComponent.dropFirst("FeatureImport-".count))) != nil,
                  let values = try? child.resourceValues(forKeys: [.creationDateKey, .isDirectoryKey, .isSymbolicLinkKey]),
                  values.isDirectory == true, values.isSymbolicLink != true,
                  let created = values.creationDate, now.timeIntervalSince(created) > 86400 else { continue }
            try? FileManager.default.removeItem(at: child)
        }
    }
}
