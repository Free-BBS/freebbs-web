import Foundation
import Security

enum TokenVault {
    private static var service: String { (Bundle.main.bundleIdentifier ?? "org.freebbs.ios") + ".session" }
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: "access-token"]
    }
    static func read() -> String? {
        var attributes = query
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(attributes as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func save(_ token: String) throws {
        var attributes = query
        attributes[kSecValueData as String] = Data(token.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let result = SecItemUpdate(query as CFDictionary, [kSecValueData as String: Data(token.utf8)] as CFDictionary)
        let status = result == errSecItemNotFound ? SecItemAdd(attributes as CFDictionary, nil) : result
        guard status == errSecSuccess else { throw VaultError.writeFailed }
    }
    static func clear() { SecItemDelete(query as CFDictionary) }
    enum VaultError: LocalizedError {
        case writeFailed
        var errorDescription: String? { "无法安全保存登录状态，请重试。" }
    }
}
