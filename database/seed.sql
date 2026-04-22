USE free_bbs;

INSERT INTO users (username, full_name, student_id, email, password_hash, email_verified_at, role, electrons, manetrons, grade, major)
VALUES (
  'admin',
  '管理员',
  '2099000000',
  'admin@free-bbs.local',
  'pbkdf2_sha256$310000$2bff87f6fd03584d270308d45669a09b$e473c473997554acfc5473b4432db6116415053523419cbbbee108998d5c4f7c',
  NOW(),
  'admin',
  0,
  0,
  NULL,
  NULL
)
ON DUPLICATE KEY UPDATE
  email = VALUES(email),
  password_hash = VALUES(password_hash),
  role = VALUES(role);
