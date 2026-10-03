import Foundation

enum WebPreferences {
    static let keys: Set<String> = [
        "free_bbs_typography_preferences", "free_bbs_theme_mode", "freebbs_ranch_scene",
        "free_bbs_course_progress_v1", "free_bbs_current_learning_node_v1", "free_bbs_last_learning_route",
        "free_bbs_knowledge_interaction_width_v1", "free_bbs_knowledge_interaction_preferences_v1",
        "free_bbs_knowledge_tools_collapsed_v1", "free_bbs_circuit_max_mode"
    ]
    static func permits(_ key: String, user: User?) -> Bool {
        keys.contains(key) || user.map { key == discoveryKey($0) } == true
    }
    static func discoveryKey(_ user: User) -> String {
        // Match the website's encodeURIComponent, including punctuation in a UID.
        let characters = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
        return "free_bbs_discovery:v1:" + (user.uid.addingPercentEncoding(withAllowedCharacters: characters) ?? user.uid)
    }
    static func accountKey(_ user: User?) -> String {
        "freebbs.web-preferences.v1." + (user.map { $0.uid.isEmpty ? "id-\($0.id)" : $0.uid } ?? "guest")
    }
}

struct ReadingStyle: Hashable {
    let fontPreset: String
    let typeScale: String
    init(raw: String?) {
        let values = raw.flatMap { $0.data(using: .utf8) }.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] } ?? [:]
        let font = values["fontPreset"] ?? "transistor-lab"
        fontPreset = ["transistor-lab", "zhongsong-study", "quantum-board", "night-oscilloscope"].contains(font) ? font : "transistor-lab"
        let scale = values["typeScale"] ?? "comfortable"
        typeScale = ["standard", "comfortable", "large"].contains(scale) ? scale : "comfortable"
    }
    var scale: Double { typeScale == "large" ? 1.18 : typeScale == "comfortable" ? 1.08 : 1 }
    var bodyFamily: String { fontPreset == "zhongsong-study" ? "'Songti SC','STSong',serif" : "-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif" }
    var headingFamily: String { ["zhongsong-study", "quantum-board"].contains(fontPreset) ? "'Songti SC','STSong',serif" : bodyFamily }
}
