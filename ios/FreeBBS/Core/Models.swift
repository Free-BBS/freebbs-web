import Foundation

struct User: Codable, Identifiable {
    let id: Int
    let uid: String
    var username: String
    var fullName: String
    let studentId: String
    let email: String?
    let role: String
    let isAdmin: Bool
    var bio: String
    var websiteUrl: String
    let avatarPath: String
    let electrons: Int
    let manetrons: Int
    let heat: Int
    let requiresUsernameChange: Bool?
}
struct Author: Codable {
    let id: Int?
    let username: String
    let displayName: String
    let avatarPath: String
}
struct Board: Codable, Identifiable, Hashable {
    let id: Int
    let slug: String
    let name: String
    let description: String
}
struct Post: Codable, Identifiable, Hashable {
    struct Preview: Codable, Hashable {
        let type: String
        let url: String?
        let alt: String?
        let cid: String?
        let revision: Int?
        let tid: String?
        let id: String?
    }
    struct Category: Codable, Hashable { let slug: String; let name: String }
    let id: String
    let title: String
    let createdAt: String
    let board: Category
    let author: Author
    let likeCount: Int
    let commentCount: Int
    let likedByMe: Bool
    let isPinned: Bool
    let isFeatured: Bool
    let contentMarkdown: String?
    let canDelete: Bool?
    var excerpt: String? = nil
    var preview: Preview? = nil
    var lightCount: Int? = nil
    var lightedByMe: Bool? = nil
    var fireworksCount: Int? = nil
    var fireworksByMe: Bool? = nil
    static func == (lhs: Post, rhs: Post) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
struct Comment: Codable, Identifiable {
    let id: Int
    let parentCommentId: Int?
    let contentMarkdown: String
    let createdAt: String
    let author: Author
    var likeCount: Int? = nil
    var likedByMe: Bool? = nil
    var isDeleted: Bool? = nil
    var canDelete: Bool? = nil
    var isFeatured: Bool? = nil
}
struct Course: Codable, Identifiable, Hashable {
    let id: Int
    let slug: String
    let name: String
    let code: String
    let boardSlug: String
    let description: String
    let summary: String
    var symbol: String {
        if slug.contains("signal") { return "waveform.path" }
        if slug.contains("circuit") { return "cpu" }
        if slug.contains("math") { return "function" }
        if slug.contains("physics") { return "atom" }
        if slug.contains("digital") { return "memorychip" }
        return "book.closed"
    }
}
struct KnowledgeNode: Codable, Identifiable, Hashable {
    struct Position: Codable, Hashable { let x: Double; let y: Double }
    struct Sections: Codable, Hashable {
        let knowledgeMarkdown: String
        let basicInfoMarkdown: String
        let applicationsMarkdown: String
    }
    let id: String
    let title: String
    let summary: String
    let position: Position
    let hasDocument: Bool
    let markdown: String?
    let sections: Sections?
}
struct MapEdge: Codable, Hashable { let source: String; let target: String; let type: String }
struct CourseMap: Codable { let course: Course; let nodes: [KnowledgeNode]; let edges: [MapEdge] }
struct InboxItem: Codable, Identifiable {
    let id: String
    let kind: String
    let title: String
    let body: String
    let link: String
    var readAt: String?
    let createdAt: String
}
struct InboxResponse: Codable {
    let notifications: [InboxItem]
    let unreadCount: Int
    let nextCursor: String?
}
struct ScheduleItem: Codable, Identifiable {
    let publicId: String
    var id: String { publicId }
    let title: String
    let description: String
    let startAt: String
    let endAt: String
    let status: String
}
struct ImportantItem: Codable, Identifiable {
    let publicId: String
    var id: String { publicId }
    let title: String
    let description: String
    let dueAt: String?
    let priority: String
}
struct WorkbenchResponse: Codable { let scheduleItems: [ScheduleItem]; let importantItems: [ImportantItem] }
struct AuthChallenge: Codable {
    struct Band: Codable {
        struct Point: Codable { let k: Double; let energy: Double }
        struct Candidate: Codable { let k: Double }
        let points: [Point]
        let candidates: [Candidate]
    }
    struct Oscillator: Codable {
        let rgOhms: Double
        let rOhms: Double
        let cFarads: Double
        let rfMinOhms: Double
        let rfMaxOhms: Double
        let rfInitialOhms: Double
        let qMin: Double
        func satisfies(_ resistance: Double) -> Bool {
            resistance > 2 * rgOhms && resistance < 4 * rgOhms &&
            resistance >= rfMinOhms && resistance <= rfMaxOhms &&
            resistance < (2 + 1 / qMin) * rgOhms
        }
    }
    let challengeId: String
    let type: String
    let expiresAt: String
    let communityAgreementVersion: String
    let carrier: String?
    let objective: String?
    let band: Band?
    let oscillator: Oscillator?
}
struct AuthResponse: Codable { let token: String; let user: User }
struct UserResponse: Codable { let user: User }
struct BoardsResponse: Codable { let boards: [Board] }
struct PostsResponse: Codable { let posts: [Post] }
struct PostResponse: Codable { let post: Post }
struct CommentsResponse: Codable { let comments: [Comment] }
struct CoursesResponse: Codable { let courses: [Course] }
struct NodeResponse: Codable { let node: KnowledgeNode }
struct MessageResponse: Codable { let message: String?; let ok: Bool? }
struct BlockedUser: Codable, Identifiable { let id: Int; let username: String }
struct BlocksResponse: Codable { let blocks: [BlockedUser] }
struct DeletionResponse: Codable { let status: String; let requestedAt: String? }

enum AppDates {
    static func parse(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
    static func short(_ value: String) -> String {
        guard let date = parse(value) else { return value }
        return date.formatted(.dateTime.month().day().hour().minute())
    }
}
