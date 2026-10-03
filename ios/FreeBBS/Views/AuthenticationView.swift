import SwiftUI
import Charts

struct AuthenticationView: View {
    enum Mode: String, CaseIterable { case login = "登录", register = "注册", reset = "找回密码" }
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var mode = Mode.login
    @State private var identifier = ""
    @State private var password = ""
    @State private var username = ""
    @State private var fullName = ""
    @State private var studentId = ""
    @State private var email = ""
    @State private var emailCode = ""
    @State private var agreed = false
    @State private var busy = false
    @State private var message: String?
    @State private var challenge: AuthChallenge?
    @State private var selectedK: Double?
    @State private var resistance = 0.0
    @State private var showPrivacy = false
    @State private var showAgreement = false
    @State private var lastCodeSent: Date?
    private var identity: String { mode == .login ? identifier : email }
    var body: some View {
        Form {
            Section {
                Text("欢迎回来，\n一起继续探索。").font(.title.bold()).padding(.vertical, 8)
                Picker("账号操作", selection: $mode) { ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) } }.pickerStyle(.segmented)
            }
            if mode == .login {
                Section {
                    TextField("用户名或邮箱", text: $identifier).textContentType(.username).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("loginIdentifier")
                    SecureField("密码", text: $password).textContentType(.password).accessibilityIdentifier("loginPassword")
                }
            } else {
                Section {
                    if mode == .register {
                        TextField("用户名（英文字母、数字、下划线）", text: $username).textContentType(.username)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                        TextField("姓名", text: $fullName).textContentType(.name)
                    }
                    TextField("学号（20 开头的 10 位数字）", text: $studentId).keyboardType(.numberPad)
                    TextField("邮箱", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField(mode == .register ? "密码（至少 6 位）" : "新密码（至少 6 位）", text: $password).textContentType(.newPassword)
                    HStack {
                        TextField("6 位邮箱验证码", text: $emailCode).keyboardType(.numberPad).textContentType(.oneTimeCode)
                        Button("发送验证码") { Task { await sendCode() } }.disabled(email.isEmpty || busy || (lastCodeSent.map { Date.now.timeIntervalSince($0) < 60 } ?? false))
                    }
                } footer: { Text(mode == .register ? "注册需匹配课程组白名单。姓名、学号与邮箱须与登记信息一致。" : "使用注册时登记的学号与邮箱找回密码。") }
                if mode == .register {
                    Section {
                        Toggle("我同意社区协议", isOn: $agreed)
                        Button("阅读社区协议") { showAgreement = true }
                    }
                }
            }
            Section {
                Button("阅读隐私政策") { showPrivacy = true }
            }
            if let challenge {
                Section {
                    ChallengeView(challenge: challenge, selectedK: $selectedK, resistance: $resistance)
                    Button("换一道题") { Task { await getChallenge() } }.disabled(busy)
                } header: { Text("互动验证") } footer: { Text("题目与账号绑定，五分钟内有效，每次提交后需要重新获取。") }
            }
            if let message { Section { Text(message).foregroundStyle(.secondary).accessibilityIdentifier("authMessage") } }
            Section {
                Button {
                    Task { if mode != .reset && challenge == nil { await getChallenge() } else { await submit() } }
                } label: {
                    HStack { Spacer(); if busy { ProgressView() }; Text(mode == .reset ? "重置密码" : (challenge == nil ? "继续" : mode.rawValue)); Spacer() }.frame(minHeight: 44)
                }.disabled(busy || !formValid || (challenge != nil && !challengeAnswered))
            }
        }.navigationTitle(mode.rawValue).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
            .onChange(of: mode) { _, _ in challenge = nil; message = nil; password = "" }
            .onChange(of: identity) { _, _ in challenge = nil }
            .sheet(isPresented: $showPrivacy) { NavigationStack { PolicyView(kind: .privacy) }.environment(store) }
            .sheet(isPresented: $showAgreement) { NavigationStack { PolicyView(kind: .community) }.environment(store) }
    }
    private var formValid: Bool {
        if mode == .login { return !identifier.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty }
        let base = studentId.count == 10 && studentId.hasPrefix("20") && email.contains("@") && password.count >= 6 && emailCode.count == 6
        return base && (mode == .reset || (!username.isEmpty && !fullName.isEmpty && agreed))
    }
    private var challengeAnswered: Bool { challenge?.type == "wien" || selectedK != nil }
    private func sendCode() async {
        guard !store.isDemo else { message = "预览模式不会发送验证码。"; return }
        busy = true; message = nil
        defer { busy = false }
        do {
            let _: MessageResponse = try await store.api.request(mode == .reset ? "/api/auth/send-reset-code" : "/api/auth/send-email-code", method: "POST", body: ["email": email, "studentId": studentId, "fullName": fullName])
            lastCodeSent = .now; message = "验证码已发送，请检查邮箱。"
        } catch { message = error.localizedDescription }
    }
    private func getChallenge() async {
        guard !store.isDemo else { message = "预览模式仅供查看登录页面，请使用正式版本验证账号。"; return }
        busy = true; message = nil; challenge = nil; selectedK = nil
        defer { busy = false }
        do {
            let result: AuthChallenge = try await store.api.request(mode == .login ? "/api/auth/login-challenge" : "/api/auth/registration-challenge", method: "POST", body: [mode == .login ? "identifier" : "email": identity])
            guard result.type == "band" && result.band != nil || result.type == "wien" && result.oscillator != nil else { throw APIError.invalidResponse }
            challenge = result; resistance = result.oscillator?.rfInitialOhms ?? 0
        } catch { message = error.localizedDescription }
    }
    private func submit() async {
        guard !store.isDemo else { message = "预览模式不会登录、注册或重置密码。"; return }
        busy = true; message = nil
        defer { busy = false }
        do {
            if mode == .reset {
                let _: MessageResponse = try await store.api.request("/api/auth/reset-password", method: "POST", body: ["studentId": studentId, "email": email, "emailCode": emailCode, "password": password])
                mode = .login; message = "密码已重置，请使用新密码登录。"; return
            }
            guard let challenge else { return }
            var captcha: [String: Any] = ["challengeId": challenge.challengeId]
            if challenge.type == "wien" { captcha["resistanceOhms"] = resistance }
            else { captcha["k"] = selectedK }
            var body: [String: Any] = ["identifier": identifier, "password": password, "captcha": captcha]
            if mode == .register {
                body.merge(["username": username, "fullName": fullName, "studentId": studentId, "email": email, "emailCode": emailCode, "communityAgreementAccepted": agreed, "communityAgreementVersion": challenge.communityAgreementVersion]) { _, new in new }
            }
            let response: AuthResponse = try await store.api.request(mode == .login ? "/api/auth/login" : "/api/auth/register", method: "POST", body: body)
            password = ""; self.challenge = nil
            try await store.accept(response)
        } catch { challenge = nil; selectedK = nil; message = error.localizedDescription }
    }
}

struct ChallengeView: View {
    let challenge: AuthChallenge
    @Binding var selectedK: Double?
    @Binding var resistance: Double
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let band = challenge.band, challenge.type == "band" {
                Text("选择\(challenge.carrier == "electron" ? "电子" : "空穴")能量的\(challenge.objective == "maximum" ? "最大" : "最小")位置。")
                Chart {
                    ForEach(Array(band.points.enumerated()), id: \.offset) { _, point in
                        LineMark(x: .value("k", point.k), y: .value("能量", point.energy)).foregroundStyle(Palette.teal)
                    }
                    ForEach(Array(band.candidates.enumerated()), id: \.offset) { index, point in
                        RuleMark(x: .value("k", point.k)).foregroundStyle(.secondary.opacity(0.3))
                            .annotation(position: .top) { Text("\(index + 1)").font(.caption) }
                    }
                }.frame(height: 160).chartXAxisLabel("k").chartYAxisLabel("能量")
                    .accessibilityLabel("能量随 k 的变化曲线")
                ForEach(Array(band.candidates.enumerated()), id: \.offset) { index, point in
                    Button { selectedK = point.k } label: {
                        HStack {
                            Image(systemName: selectedK == point.k ? "checkmark.circle.fill" : "circle")
                            Text("位置 \(index + 1)，k = \(point.k.formatted(.number.precision(.fractionLength(2))))")
                            Spacer()
                            if let energy = band.points.min(by: { abs($0.k - point.k) < abs($1.k - point.k) })?.energy {
                                Text(energy.formatted(.number.precision(.fractionLength(2)))).font(.caption)
                            }
                        }.frame(minHeight: 44)
                    }.buttonStyle(.plain).foregroundStyle(selectedK == point.k ? Palette.teal : .primary)
                        .accessibilityAddTraits(selectedK == point.k ? .isSelected : [])
                }
            } else if let oscillator = challenge.oscillator {
                Text("调节文氏振荡器的反馈电阻 Rf，使电路起振且 Q > \(oscillator.qMin.formatted())。")
                Text("Rg = \(oscillator.rgOhms.formatted()) Ω\nR1 = R2 = \(oscillator.rOhms.formatted()) Ω\nC1 = C2 = \(oscillator.cFarads.formatted()) F")
                    .font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
                Label("Rf = \(resistance.formatted(.number.precision(.fractionLength(0)))) Ω", systemImage: "slider.horizontal.3").font(.headline)
                Slider(value: $resistance, in: oscillator.rfMinOhms...oscillator.rfMaxOhms, step: 1)
                    .accessibilityLabel("反馈电阻 Rf").accessibilityValue("\(Int(resistance)) 欧姆")
                let gain = 1 + resistance / oscillator.rgOhms
                let q = 1 / abs(3 - gain)
                Text("增益 A = \(gain.formatted(.number.precision(.fractionLength(2)))) · Q = \(q.isFinite ? q.formatted(.number.precision(.fractionLength(2))) : "∞")")
                    .font(.footnote).foregroundStyle(.secondary)
                Label(oscillator.satisfies(resistance) ? "满足起振与 Q 条件" : "继续调节反馈电阻", systemImage: oscillator.satisfies(resistance) ? "checkmark.circle" : "waveform.path")
                    .foregroundStyle(Palette.teal)
            }
        }.padding(.vertical, 12)
    }
}
