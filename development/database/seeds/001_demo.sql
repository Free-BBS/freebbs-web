INSERT INTO subjects
  (id, uid, display_name, avatar_url, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('subject-admin', 'demo-admin', '发展端管理员', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-student', 'demo-student', '普通同学', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-rights-member', 'demo-rights-member', '权益发展中心部员', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-liaison-member', 'demo-liaison-member', '联络中心部员', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-sports-lead', 'demo-sports-lead', '体育负责人', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-sports-director', 'demo-sports-director', '体育中心部长', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-captain', 'demo-captain', '篮球队队长', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-tuanwei-lead', 'demo-tuanwei-lead', '团委负责人', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3));

INSERT INTO roles
  (id, role_key, name, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('role-admin', 'platform.super_admin', '最高权限', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('role-rights-member', 'department.rights_development_member', '权益发展中心部员', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('role-liaison-member', 'department.liaison_member', '联络中心部员', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('role-sports-lead', 'domain.sports_lead', '体育负责人', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('role-sports-director', 'department.sports_director', '体育中心部长', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('role-tuanwei-lead', 'affiliation.tuanwei_lead', '团委负责人', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3));

INSERT INTO role_assignments
  (id, subject_uid, role_key, expires_at, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('assignment-rights-member', 'demo-rights-member', 'department.rights_development_member', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('assignment-liaison-member', 'demo-liaison-member', 'department.liaison_member', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('assignment-sports-lead', 'demo-sports-lead', 'domain.sports_lead', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('assignment-sports-director', 'demo-sports-director', 'department.sports_director', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('assignment-tuanwei-lead', 'demo-tuanwei-lead', 'affiliation.tuanwei_lead', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3));

INSERT INTO tag_definitions
  (id, tag_key, name, description, required_scope_type, metadata, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('tag-captain', 'sports.team_captain', '体育代表队队长', '仅在绑定代表队内生效。', 'sports_team', JSON_OBJECT('resourceTypes', JSON_ARRAY('sports_team')), 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('tag-rights-center', 'social_org.rights_development_center', '权益发展中心', '权益发展中心组织身份。', 'social_organization', JSON_OBJECT('resourceTypes', JSON_ARRAY()), 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('tag-liaison-center', 'social_org.liaison_center', '联络中心', '联络中心组织身份。', 'social_organization', JSON_OBJECT('resourceTypes', JSON_ARRAY()), 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('tag-sports-center', 'social_org.sports_center', '体育中心', '体育中心组织身份。', 'social_organization', JSON_OBJECT('resourceTypes', JSON_ARRAY()), 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('tag-tuanwei', 'social_org.tuanwei', '团委', '团委组织身份。', 'social_organization', JSON_OBJECT('resourceTypes', JSON_ARRAY()), 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('tag-extension', 'extension.custom', '扩展权限标签', '为后续模块保留的标签接口。', NULL, JSON_OBJECT('resourceTypes', JSON_ARRAY()), 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3));

INSERT INTO tag_assignments
  (id, subject_uid, tag_key, expires_at, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('tag-captain-basketball', 'demo-captain', 'sports.team_captain', NULL, 'active', 'demo-admin', 'sports_team', 'team-basketball', NOW(3), NOW(3)),
  ('tag-rights-organization', 'demo-rights-member', 'social_org.rights_development_center', NULL, 'active', 'demo-admin', 'social_organization', 'rights_development_center', NOW(3), NOW(3)),
  ('tag-liaison-organization', 'demo-liaison-member', 'social_org.liaison_center', NULL, 'active', 'demo-admin', 'social_organization', 'liaison_center', NOW(3), NOW(3)),
  ('tag-sports-lead-organization', 'demo-sports-lead', 'social_org.sports_center', NULL, 'active', 'demo-admin', 'social_organization', 'sports_center', NOW(3), NOW(3)),
  ('tag-sports-director-organization', 'demo-sports-director', 'social_org.sports_center', NULL, 'active', 'demo-admin', 'social_organization', 'sports_center', NOW(3), NOW(3)),
  ('tag-tuanwei-organization', 'demo-tuanwei-lead', 'social_org.tuanwei', NULL, 'active', 'demo-admin', 'social_organization', 'tuanwei', NOW(3), NOW(3));

INSERT INTO modules
  (id, module_id, name, description, enabled, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('module-dashboard', 'dashboard', '工作台', '聚合发展端信息与入口。', TRUE, 'enabled', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('module-knowledge', 'knowledge', '经验库', '维护部门经验与流程。', TRUE, 'enabled', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('module-information', 'information', '信息与咨询', '发布信息并跟进咨询。', TRUE, 'enabled', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('module-clubs', 'clubs', '趣缘群体', '建设和管理校园趣缘群体。', TRUE, 'enabled', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('module-events', 'events', '活动', '规范活动举办与报名。', TRUE, 'enabled', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('module-liaison', 'liaison', '联络资源', '维护联络人与资源入口。', TRUE, 'enabled', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('module-sports', 'sports', '体育代表队', '管理代表队与训练签到。', TRUE, 'enabled', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('module-finance', 'finance', '财务治理', '维护预算与结算记录。', TRUE, 'enabled', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('module-admin', 'admin', '权限与模块管理', '统一管理权限、标签和模块。', TRUE, 'enabled', 'demo-admin', 'public', '*', NOW(3), NOW(3));

INSERT INTO knowledge_entries
  (id, entry_type, title, body, audience, organization_id, status, owner_uid, scope_type, scope_id, created_at, updated_at, category, tags, summary, maintained_at, maintainer_uid)
VALUES
  ('knowledge-workflow', 'workflow', '活动立项与复盘流程', '从立项、审批到复盘的标准步骤。', 'general', NULL, 'published', 'demo-admin', 'public', '*', NOW(3), NOW(3), '活动指南', JSON_ARRAY('十月预告', '活动流程'), '十月活动立项、审批和复盘速查。', '2026-10-01 00:00:00.000', 'demo-admin'),
  ('knowledge-faq', 'faq', '部门交接常见问题', '集中说明账号、资料和联系人交接。', 'general', NULL, 'published', 'demo-admin', 'public', '*', NOW(3), NOW(3), '部门交接', JSON_ARRAY('十月预告', '交接'), '秋季部门账号、资料与联系人交接说明。', '2026-10-01 00:00:00.000', 'demo-admin'),
  ('knowledge-sports-handover', 'workflow', '体育中心代表队交接清单', '整理代表队联系人、训练安排、报名节点、常见问题与年度复盘。', 'social_org', 'sports_center', 'published', 'demo-sports-lead', 'social_organization', 'sports_center', NOW(3), NOW(3), '代表队管理', JSON_ARRAY('十月预告', '代表队'), '秋季代表队训练、招募和赛事交接清单。', '2026-10-01 00:00:00.000', 'demo-sports-lead');

INSERT INTO announcements
  (id, title, body, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('announcement-club', '秋季趣缘群体招新开放', '欢迎同学浏览并加入感兴趣的趣缘群体。', 'published', 'demo-liaison-member', 'public', '*', NOW(3), NOW(3)),
  ('announcement-consultation', '权益咨询窗口更新时间', '工作日咨询将在两个工作日内完成分流。', 'published', 'demo-rights-member', 'public', '*', NOW(3), NOW(3));

INSERT INTO consultations
  (id, title, body, requester_uid, assignee_uid, reply, status, owner_uid, scope_type, scope_id, created_at, updated_at, due_at)
VALUES
  ('consultation-venue', '活动场地申请', '请问教学楼公共空间如何申请？', 'demo-student', 'demo-rights-member', '请填写场地预约表并等待管理员确认。', 'in_progress', 'demo-student', 'public', '*', NOW(3), NOW(3), '2026-10-08 10:00:00.000'),
  ('consultation-rights', '校园权益建议', '希望延长公共讨论空间开放时间。', 'demo-student', 'demo-rights-member', NULL, 'in_progress', 'demo-student', 'public', '*', NOW(3), NOW(3), '2026-10-10 10:00:00.000');

INSERT INTO proposals
  (id, title, problem_description, proposed_solution, category, submitter_uid, assignee_uid, public_progress, internal_note, status, owner_uid, scope_type, scope_id, created_at, updated_at, due_at)
VALUES
  ('proposal-night-lighting', '校园夜间照明优化', '部分公共活动区域夜间照明不足，影响同学通行与活动。', '梳理重点点位并与相关部门共同推进照明巡检和补充。', '校园空间', 'demo-student', 'demo-rights-member', '已收集首批点位，正在核实现场情况。', '下一步联系物业与相关场馆负责人。', 'reviewing', 'demo-student', 'public', '*', NOW(3), NOW(3), '2026-10-15 10:00:00.000');

INSERT INTO clubs
  (id, name, description, organization_id, technical_support_status, technical_support_note, status, owner_uid, scope_type, scope_id, created_at, updated_at, category, contact_name, public_contact)
VALUES
  ('club-music', '校园音乐俱乐部', '排练、分享与小型演出。', 'liaison_center', 'requested', '需要演出音响调试支持。', 'active', 'demo-liaison-member', 'public', '*', NOW(3), NOW(3), '文艺交流', '音乐俱乐部联络员', '每周五学生活动中心排练室'),
  ('club-running', '自由跑团', '每周轻松跑与训练交流。', 'liaison_center', 'not_requested', NULL, 'active', 'demo-liaison-member', 'public', '*', NOW(3), NOW(3), '体育户外', '跑团联络员', '每周三东大操场集合点');

INSERT INTO club_memberships
  (id, club_id, member_uid, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('membership-music', 'club-music', 'demo-student', 'active', 'demo-student', 'club', 'club-music', NOW(3), NOW(3)),
  ('membership-running', 'club-running', 'demo-captain', 'active', 'demo-captain', 'club', 'club-running', NOW(3), NOW(3));

INSERT INTO activities
  (id, title, description, club_id, starts_at, ends_at, location, organization_id, standing_activity, technical_support_status, technical_support_note, status, owner_uid, scope_type, scope_id, created_at, updated_at, registration_deadline, capacity, contact)
VALUES
  ('activity-orientation', '新生趣缘群体见面会', '一次认识各趣缘群体的开放活动。', NULL, '2026-09-05 10:00:00.000', '2026-09-05 12:00:00.000', '中央主楼大厅', 'liaison_center', FALSE, 'requested', '需要现场网络与投影支持。', 'published', 'demo-liaison-member', 'public', '*', NOW(3), NOW(3), '2026-09-04 10:00:00.000', 120, '联络中心活动咨询台'),
  ('activity-night-run', '校园夜跑', '五公里轻松跑。', 'club-running', '2026-09-12 19:00:00.000', '2026-09-12 21:00:00.000', '东大操场', 'sports_center', FALSE, 'confirmed', '路线签到设备已确认。', 'published', 'demo-sports-lead', 'public', '*', NOW(3), NOW(3), '2026-09-11 10:00:00.000', 60, '跑团联络员（东大操场集合点）'),
  ('activity-ma-john-cup', '马约翰杯', '学院代表队参加的常设综合体育赛事，集中展示赛程与比赛进展。', NULL, '2026-10-10 08:00:00.000', '2026-11-15 10:00:00.000', '清华大学各体育场馆', 'sports_center', TRUE, 'not_requested', NULL, 'published', 'demo-sports-lead', 'public', '*', NOW(3), NOW(3), '2026-10-08 10:00:00.000', 240, '体育中心赛事咨询台');

INSERT INTO activity_milestones
  (id, activity_id, occurs_at, title, milestone_type, description, completed, display_order, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('milestone-ma-host', 'activity-ma-john-cup', '2026-09-01 10:00:00.000', '主持人推送', 'promotion', '发布主持人和赛事志愿者招募信息。', TRUE, 1, 'active', 'demo-sports-lead', 'activity', 'activity-ma-john-cup', NOW(3), NOW(3)),
  ('milestone-ma-registration', 'activity-ma-john-cup', '2026-09-10 10:00:00.000', '队员招募推送', 'registration', '各代表队开放报名与选拔。', TRUE, 2, 'active', 'demo-sports-lead', 'activity', 'activity-ma-john-cup', NOW(3), NOW(3)),
  ('milestone-ma-preliminary', 'activity-ma-john-cup', '2026-10-10 08:00:00.000', '初赛', 'competition', '各项目初赛与小组赛开始。', FALSE, 3, 'active', 'demo-sports-lead', 'activity', 'activity-ma-john-cup', NOW(3), NOW(3)),
  ('milestone-ma-final', 'activity-ma-john-cup', '2026-11-15 08:00:00.000', '决赛', 'competition', '决赛日与闭幕总结。', FALSE, 4, 'active', 'demo-sports-lead', 'activity', 'activity-ma-john-cup', NOW(3), NOW(3));

INSERT INTO competition_fixtures
  (id, activity_id, round_name, participant_a, participant_b, scheduled_at, location, score, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('fixture-ma-group-1', 'activity-ma-john-cup', '小组赛', '电子系', '自动化系', '2026-10-10 11:00:00.000', '东大操场', NULL, 'scheduled', 'demo-sports-lead', 'activity', 'activity-ma-john-cup', NOW(3), NOW(3));

INSERT INTO activity_registrations
  (id, activity_id, participant_uid, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('registration-orientation', 'activity-orientation', 'demo-student', 'registered', 'demo-student', 'activity', 'activity-orientation', NOW(3), NOW(3)),
  ('registration-night-run', 'activity-night-run', 'demo-captain', 'registered', 'demo-captain', 'activity', 'activity-night-run', NOW(3), NOW(3));

INSERT INTO sports_teams
  (id, name, description, status, owner_uid, scope_type, scope_id, created_at, updated_at, season, training_schedule)
VALUES
  ('team-basketball', '院篮球队', '学院篮球代表队。', 'active', 'demo-sports-lead', 'sports_team', 'team-basketball', NOW(3), NOW(3), '2026秋季', '每周二、四 18:00–20:00，篮球馆'),
  ('team-badminton', '院羽毛球队', '学院羽毛球代表队。', 'active', 'demo-sports-lead', 'sports_team', 'team-badminton', NOW(3), NOW(3), '2026秋季', '每周三 18:00–20:00，羽毛球馆');

INSERT INTO sports_team_members
  (id, team_id, member_uid, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('sports-member-basketball-captain', 'team-basketball', 'demo-captain', 'active', 'demo-sports-lead', 'sports_team', 'team-basketball', NOW(3), NOW(3)),
  ('sports-member-basketball-student', 'team-basketball', 'demo-student', 'active', 'demo-sports-lead', 'sports_team', 'team-basketball', NOW(3), NOW(3));

INSERT INTO sports_checkins
  (id, team_id, member_uid, checkin_date, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('checkin-basketball-captain', 'team-basketball', 'demo-captain', '2026-07-21', 'present', 'demo-captain', 'sports_team', 'team-basketball', NOW(3), NOW(3)),
  ('checkin-basketball-student', 'team-basketball', 'demo-student', '2026-07-21', 'present', 'demo-captain', 'sports_team', 'team-basketball', NOW(3), NOW(3));

INSERT INTO liaison_resources
  (id, name, description, category, visibility, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('liaison-tuanwei', '校团委活动联络窗口', '大型活动审批与资源协调。', 'contact', 'public', 'active', 'demo-liaison-member', 'public', '*', NOW(3), NOW(3)),
  ('liaison-venue', '公共场地预约说明', '常用场地管理部门和预约入口。', 'venue', 'organization', 'active', 'demo-liaison-member', 'organization', 'freebbs', NOW(3), NOW(3));

INSERT INTO liaison_problems
  (id, title, summary, background, source_type, source_name, tags, expected_outcome, constraints_text, starts_at, deadline, public_contact, internal_contact_note, recorder_uid, reviewer_uid, reviewed_at, review_note, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('liaison-problem-lab-energy', '校园能耗数据可视化', '把匿名化能耗指标转化为同学可理解的交互展示。', '校内课题组希望验证面向校园公共空间的数据叙事方案。', 'lab', '校园计算实验室', JSON_ARRAY('数据可视化', '前端', '校园治理'), '可运行原型、设计说明和一次公开演示。', '只能使用匿名化样例数据，不得上传原始敏感数据。', '2026-10-01 00:00:00.000', '2026-11-15 00:00:00.000', '联络中心公开咨询台', '演示数据由联络中心线下转交。', 'demo-liaison-member', 'demo-tuanwei-lead', '2026-09-20 08:00:00.000', '已确认公开范围与匿名化要求。', 'open', 'demo-liaison-member', 'public', '*', '2026-09-20 08:00:00.000', '2026-09-20 08:00:00.000'),
  ('liaison-problem-company-accessibility', '公共服务页面无障碍检查工具', '为常见校园服务页面制作轻量的可访问性检查原型。', '合作企业希望与同学共同验证前端无障碍检查流程。', 'company', '校企联合创新伙伴', JSON_ARRAY('无障碍', 'Web', '工具开发'), '检查清单、命令行原型和示例报告。', '首期只分析公开页面，不采集账号或个人信息。', '2026-10-10 00:00:00.000', NULL, '联络中心公开咨询台', '企业联系人信息由联络中心保管。', 'demo-liaison-member', 'demo-admin', '2026-09-22 08:00:00.000', '公开内容已脱敏。', 'open', 'demo-liaison-member', 'public', '*', '2026-09-22 08:00:00.000', '2026-09-22 08:00:00.000');

INSERT INTO liaison_teams
  (id, problem_id, name, proposal, maintainer_uid, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('liaison-team-energy-story', 'liaison-problem-lab-energy', '数据叙事队', '先建立公共指标卡片，再制作可解释的趋势视图。', 'demo-student', 'active', 'demo-student', 'liaison_problem', 'liaison-problem-lab-energy', '2026-10-02 08:00:00.000', '2026-10-02 08:00:00.000'),
  ('liaison-team-energy-map', 'liaison-problem-lab-energy', '空间可视化队', '使用匿名化建筑指标制作校园能耗地图原型。', 'demo-captain', 'active', 'demo-captain', 'liaison_problem', 'liaison-problem-lab-energy', '2026-10-03 08:00:00.000', '2026-10-03 08:00:00.000');

INSERT INTO liaison_team_members
  (id, problem_id, team_id, member_uid, member_role, joined_at, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('liaison-member-energy-story', 'liaison-problem-lab-energy', 'liaison-team-energy-story', 'demo-student', 'maintainer', '2026-10-02 08:00:00.000', 'active', 'demo-student', 'liaison_team', 'liaison-team-energy-story', '2026-10-02 08:00:00.000', '2026-10-02 08:00:00.000'),
  ('liaison-member-energy-map', 'liaison-problem-lab-energy', 'liaison-team-energy-map', 'demo-captain', 'maintainer', '2026-10-03 08:00:00.000', 'active', 'demo-captain', 'liaison_team', 'liaison-team-energy-map', '2026-10-03 08:00:00.000', '2026-10-03 08:00:00.000');

INSERT INTO liaison_posts
  (id, problem_id, team_id, author_uid, post_kind, body, hidden_at, hidden_by_uid, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('liaison-post-energy-question', 'liaison-problem-lab-energy', NULL, 'demo-student', 'discussion', '公开样例数据会提供哪些时间粒度？', NULL, NULL, 'visible', 'demo-student', 'liaison_problem', 'liaison-problem-lab-energy', '2026-10-04 08:00:00.000', '2026-10-04 08:00:00.000'),
  ('liaison-post-energy-story-progress', 'liaison-problem-lab-energy', 'liaison-team-energy-story', 'demo-student', 'progress', '已完成指标卡片的信息层级草图。', NULL, NULL, 'visible', 'demo-student', 'liaison_problem', 'liaison-problem-lab-energy', '2026-10-08 08:00:00.000', '2026-10-08 08:00:00.000'),
  ('liaison-post-energy-map-progress', 'liaison-problem-lab-energy', 'liaison-team-energy-map', 'demo-captain', 'progress', '已完成地图底图和匿名化样例数据接入。', NULL, NULL, 'visible', 'demo-captain', 'liaison_problem', 'liaison-problem-lab-energy', '2026-10-09 08:00:00.000', '2026-10-09 08:00:00.000');

INSERT INTO liaison_outcomes
  (id, problem_id, team_id, version, title, description, link_url, attachment_ref, submitted_at, adopted_at, adopted_by_uid, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('liaison-outcome-energy-story-v1', 'liaison-problem-lab-energy', 'liaison-team-energy-story', 1, '能耗指标叙事原型', '包含关键指标卡片、趋势解释和公开演示说明。', 'https://example.invalid/freebbs/energy-story', NULL, '2026-10-20 08:00:00.000', '2026-10-22 08:00:00.000', 'demo-liaison-member', 'adopted', 'demo-student', 'liaison_team', 'liaison-team-energy-story', '2026-10-20 08:00:00.000', '2026-10-22 08:00:00.000');

INSERT INTO finance_records
  (id, title, record_kind, amount_cents, activity_id, organization_id, reviewer_uid, reviewed_at, review_decision, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('finance-orientation-budget', '新生见面会预算', 'budget', 150000, 'activity-orientation', 'liaison_center', 'demo-tuanwei-lead', '2026-07-22 08:00:00.000', 'approved', 'approved', 'demo-liaison-member', 'activity', 'activity-orientation', NOW(3), NOW(3)),
  ('finance-night-run-settlement', '校园夜跑物资结算', 'settlement', 48600, 'activity-night-run', 'sports_center', NULL, NULL, NULL, 'submitted', 'demo-sports-lead', 'activity', 'activity-night-run', NOW(3), NOW(3));

INSERT INTO subjects
  (id, uid, display_name, avatar_url, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('subject-arts-member', 'demo-arts-member', '文艺中心部员', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-arts-director', 'demo-arts-director', '文艺中心部长', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-arts-lead', 'demo-arts-lead', '文艺中心负责人', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-sports-member', 'demo-sports-member', '体育中心部员', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-liaison-director', 'demo-liaison-director', '联络中心部长', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-liaison-lead', 'demo-liaison-lead', '联络中心负责人', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-rights-director', 'demo-rights-director', '权发中心部长', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('subject-rights-lead', 'demo-rights-lead', '权发中心负责人', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3));

INSERT INTO roles
  (id, role_key, name, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('role-arts-member', 'department.arts_member', '文艺中心部员', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('role-arts-director', 'department.arts_director', '文艺中心部长', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('role-arts-lead', 'domain.arts_lead', '文艺中心负责人', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('role-sports-member', 'department.sports_member', '体育中心部员', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('role-liaison-director', 'department.liaison_director', '联络中心部长', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('role-liaison-lead', 'domain.liaison_lead', '联络中心负责人', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('role-rights-director', 'department.rights_development_director', '权发中心部长', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('role-rights-lead', 'domain.rights_development_lead', '权发中心负责人', 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3));

INSERT INTO role_assignments
  (id, subject_uid, role_key, expires_at, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('assignment-arts-member', 'demo-arts-member', 'department.arts_member', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('assignment-arts-director', 'demo-arts-director', 'department.arts_director', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('assignment-arts-lead', 'demo-arts-lead', 'domain.arts_lead', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('assignment-sports-member', 'demo-sports-member', 'department.sports_member', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('assignment-liaison-director', 'demo-liaison-director', 'department.liaison_director', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('assignment-liaison-lead', 'demo-liaison-lead', 'domain.liaison_lead', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('assignment-rights-director', 'demo-rights-director', 'department.rights_development_director', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3)),
  ('assignment-rights-lead', 'demo-rights-lead', 'domain.rights_development_lead', NULL, 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3));

INSERT INTO tag_definitions
  (id, tag_key, name, description, required_scope_type, metadata, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('tag-arts-center', 'social_org.arts_center', '文艺中心', '文艺中心组织身份。', 'social_organization', JSON_OBJECT('resourceTypes', JSON_ARRAY()), 'active', 'demo-admin', 'public', '*', NOW(3), NOW(3));

INSERT INTO tag_assignments
  (id, subject_uid, tag_key, expires_at, status, owner_uid, scope_type, scope_id, created_at, updated_at)
VALUES
  ('tag-arts-member-organization', 'demo-arts-member', 'social_org.arts_center', NULL, 'active', 'demo-admin', 'social_organization', 'arts_center', NOW(3), NOW(3)),
  ('tag-arts-director-organization', 'demo-arts-director', 'social_org.arts_center', NULL, 'active', 'demo-admin', 'social_organization', 'arts_center', NOW(3), NOW(3)),
  ('tag-arts-lead-organization', 'demo-arts-lead', 'social_org.arts_center', NULL, 'active', 'demo-admin', 'social_organization', 'arts_center', NOW(3), NOW(3)),
  ('tag-sports-member-organization', 'demo-sports-member', 'social_org.sports_center', NULL, 'active', 'demo-admin', 'social_organization', 'sports_center', NOW(3), NOW(3)),
  ('tag-liaison-director-organization', 'demo-liaison-director', 'social_org.liaison_center', NULL, 'active', 'demo-admin', 'social_organization', 'liaison_center', NOW(3), NOW(3)),
  ('tag-liaison-lead-organization', 'demo-liaison-lead', 'social_org.liaison_center', NULL, 'active', 'demo-admin', 'social_organization', 'liaison_center', NOW(3), NOW(3)),
  ('tag-rights-director-organization', 'demo-rights-director', 'social_org.rights_development_center', NULL, 'active', 'demo-admin', 'social_organization', 'rights_development_center', NOW(3), NOW(3)),
  ('tag-rights-lead-organization', 'demo-rights-lead', 'social_org.rights_development_center', NULL, 'active', 'demo-admin', 'social_organization', 'rights_development_center', NOW(3), NOW(3));
