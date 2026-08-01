USE free_bbs;

INSERT INTO users (username, full_name, student_id, email, password_hash, email_verified_at, role, is_admin, electrons, manetrons, grade, major)
VALUES (
  'admin',
  '管理员',
  '2099000000',
  'admin@free-bbs.local',
  'pbkdf2_sha256$310000$2bff87f6fd03584d270308d45669a09b$e473c473997554acfc5473b4432db6116415053523419cbbbee108998d5c4f7c',
  NOW(),
  'admin',
  1,
  0,
  0,
  NULL,
  NULL
)
ON DUPLICATE KEY UPDATE
  email = VALUES(email),
  password_hash = VALUES(password_hash),
  role = VALUES(role),
  is_admin = VALUES(is_admin);

-- Clearly labelled local Alpha data for the workbench interaction demo.
INSERT INTO notifications (
  public_id, recipient_user_id, publisher_user_id, category, source_type,
  source_reference, title, body, action_url, importance, status, deadline_at, published_at
)
SELECT
  'wn_demo_network_classroom', u.id, u.id, 'course', 'network_classroom',
  'demo:network-classroom:assignment', '[演示数据] 网络学堂作业提醒',
  '用于验证通知筛选、已读和收藏交互，不代表真实校内数据。',
  'https://learn.tsinghua.edu.cn/', 'important', 'published',
  DATE_ADD(NOW(), INTERVAL 2 DAY), NOW()
FROM users u
WHERE u.username = 'admin'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), body = VALUES(body), published_at = VALUES(published_at);

INSERT INTO notifications (
  public_id, recipient_user_id, publisher_user_id, category, source_type,
  source_reference, title, body, action_url, importance, status, deadline_at, published_at
)
SELECT
  'wn_demo_info_portal', u.id, u.id, 'system', 'info',
  'demo:info:profile', '[演示数据] 信息门户事项提醒',
  '用于验证信息门户来源标记，不包含任何统一身份认证数据。',
  'https://info.tsinghua.edu.cn/', 'normal', 'published', NULL, NOW()
FROM users u
WHERE u.username = 'admin'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), body = VALUES(body), published_at = VALUES(published_at);

INSERT INTO important_items (
  public_id, user_id, created_by_user_id, dedupe_key, source_type,
  title, description, due_at, priority, status, user_confirmed_at
)
SELECT
  'wi_demo_alpha_report', u.id, u.id, 'demo:important:alpha-report', 'manual',
  '[演示数据] 整理 Alpha 汇报', '用于验证事项编辑、完成和删除。',
  DATE_ADD(NOW(), INTERVAL 1 DAY), 'high', 'confirmed', NOW()
FROM users u
WHERE u.username = 'admin'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), description = VALUES(description), due_at = VALUES(due_at),
  priority = VALUES(priority), status = VALUES(status), deleted_at = NULL;

INSERT INTO schedule_items (
  public_id, user_id, created_by_user_id, dedupe_key, source_type,
  source_reference, title, description, start_at, end_at, all_day,
  timezone, status, user_confirmed_at
)
SELECT
  'ws_demo_focus_session', u.id, u.id, 'demo:schedule:focus', 'manual',
  'demo:manual:focus', '[演示数据] 项目集中开发', '用于验证日程编辑和冲突检查。',
  DATE_ADD(TIMESTAMP(CURRENT_DATE, '19:00:00'), INTERVAL 1 DAY),
  DATE_ADD(TIMESTAMP(CURRENT_DATE, '21:00:00'), INTERVAL 1 DAY),
  0, 'Asia/Shanghai', 'confirmed', NOW()
FROM users u
WHERE u.username = 'admin'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), description = VALUES(description), start_at = VALUES(start_at),
  end_at = VALUES(end_at), status = VALUES(status), deleted_at = NULL;

INSERT INTO schedule_items (
  public_id, user_id, created_by_user_id, dedupe_key, source_type,
  source_reference, title, description, start_at, end_at, all_day,
  timezone, status, user_confirmed_at
)
SELECT
  'ws_demo_agent_draft', u.id, u.id, 'demo:schedule:agent-draft', 'agent',
  'demo:agent:planning', '[演示数据] 工作管家复习草稿',
  'Agent 只生成草稿；需要用户点击确认后才进入正式时间表。',
  DATE_ADD(TIMESTAMP(CURRENT_DATE, '20:00:00'), INTERVAL 1 DAY),
  DATE_ADD(TIMESTAMP(CURRENT_DATE, '21:30:00'), INTERVAL 1 DAY),
  0, 'Asia/Shanghai', 'draft', NULL
FROM users u
WHERE u.username = 'admin'
ON DUPLICATE KEY UPDATE
  title = VALUES(title), description = VALUES(description), start_at = VALUES(start_at),
  end_at = VALUES(end_at), status = 'draft', user_confirmed_at = NULL, deleted_at = NULL;
