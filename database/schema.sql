CREATE DATABASE IF NOT EXISTS free_bbs
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE free_bbs;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(64) NOT NULL UNIQUE,
    full_name VARCHAR(64) NOT NULL,
    student_id VARCHAR(10) NOT NULL UNIQUE,
    email VARCHAR(128) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email_verified_at DATETIME NULL,
    role ENUM('student', 'ta', 'teacher', 'admin') DEFAULT 'student',
    electrons BIGINT NOT NULL DEFAULT 0,
    manetrons BIGINT NOT NULL DEFAULT 0,
    grade VARCHAR(16),
    major VARCHAR(64),
    avatar_path VARCHAR(255) NULL,
    bio TEXT NULL,
    website_url VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_verification_codes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(128) NOT NULL,
    code_hash VARCHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email_verification_codes_email (email),
    INDEX idx_email_verification_codes_expires_at (expires_at)
);
