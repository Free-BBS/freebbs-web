import SwiftUI

@main
struct FreeBBSApp: App {
    @State private var store = AppStore()
    var body: some Scene {
        WindowGroup {
            RootView().environment(store).tint(Color.accentColor)
                .task { await store.bootstrap() }
        }
    }
}
