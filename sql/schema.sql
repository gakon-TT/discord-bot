CREATE DATABASE IF NOT EXISTS whitelist
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE whitelist;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  discord_id VARCHAR(32) NOT NULL UNIQUE,
  discord_username VARCHAR(100) NULL,
  discord_email VARCHAR(255) NULL,
  ip VARCHAR(64) NULL,
  geo_location VARCHAR(120) NULL,
  isp VARCHAR(120) NULL,
  device VARCHAR(120) NULL,
  fingerprint VARCHAR(64) NULL,
  cookie VARCHAR(64) NULL,
  access_token VARCHAR(255) NULL,
  refresh_token VARCHAR(255) NULL,
  token_expires_at DATETIME NULL,
  oauth_scope VARCHAR(255) NULL,
  verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS whitelist_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  discord_id VARCHAR(32) NOT NULL,
  discord_username VARCHAR(100) NULL,
  full_name VARCHAR(120) NOT NULL,
  birth_date VARCHAR(30) NOT NULL,
  gender VARCHAR(30) NOT NULL,
  social_link VARCHAR(255) NULL,
  phone TEXT NULL,
  guarantee_code VARCHAR(32) NULL,
  ip VARCHAR(64) NULL,
  geo_location VARCHAR(120) NULL,
  isp VARCHAR(120) NULL,
  device VARCHAR(120) NULL,
  fingerprint VARCHAR(64) NULL,
  cookie VARCHAR(64) NULL,
  status ENUM('pending','approved','rejected','cancelled','blocked') NOT NULL DEFAULT 'pending',
  rejection_reason VARCHAR(500) NULL,
  review_message_id VARCHAR(32) NULL,
  reviewed_by VARCHAR(32) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app_discord_status (discord_id, status),
  INDEX idx_status (status)
);

CREATE TABLE IF NOT EXISTS guarantee_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  owner_discord_id VARCHAR(32) NOT NULL,
  max_slots INT NOT NULL DEFAULT 1,
  used_slots INT NOT NULL DEFAULT 0,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  INDEX idx_owner (owner_discord_id)
);

CREATE TABLE IF NOT EXISTS guarantee_uses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code_id INT NOT NULL,
  code VARCHAR(32) NOT NULL,
  owner_discord_id VARCHAR(32) NOT NULL,
  receiver_discord_id VARCHAR(32) NOT NULL,
  application_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_receiver_code (code_id, receiver_discord_id),
  CONSTRAINT fk_guarantee_code
    FOREIGN KEY (code_id) REFERENCES guarantee_codes(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS whitelist_players (
  id INT AUTO_INCREMENT PRIMARY KEY,
  discord_id VARCHAR(32) NOT NULL UNIQUE,
  application_id INT NULL,
  full_name VARCHAR(120) NULL,
  license_identifier VARCHAR(100) NULL,
  license2_identifier VARCHAR(100) NULL,
  fivem_identifier VARCHAR(100) NULL,
  status ENUM('active','revoked') NOT NULL DEFAULT 'active',
  approved_by VARCHAR(32) NULL,
  approved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_license (license_identifier),
  INDEX idx_license2 (license2_identifier),
  INDEX idx_fivem (fivem_identifier)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state VARCHAR(128) PRIMARY KEY,
  expires_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_type VARCHAR(50) NOT NULL,
  channel_id VARCHAR(64) NOT NULL,
  discord_id VARCHAR(64) NOT NULL,
  status ENUM('open','closed') DEFAULT 'open',
  is_pinned TINYINT(1) DEFAULT 0,
  pinned_by VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  closed_by VARCHAR(64) NULL,
  INDEX idx_tickets_discord_status (discord_id, status),
  INDEX idx_tickets_channel (channel_id),
  INDEX idx_tickets_status (status)
);


