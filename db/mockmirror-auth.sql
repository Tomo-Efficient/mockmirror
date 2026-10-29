-- 面镜 MockMirror · 账号与按用户隔离的数据
-- 应用启动时由 initAuth() 自动创建。
CREATE TABLE IF NOT EXISTS mockmirror_users (
  id uuid PRIMARY KEY,
  email varchar(160) UNIQUE NOT NULL,
  name varchar(60) NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mockmirror_auth_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES mockmirror_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mockmirror_auth_sessions_user_idx
  ON mockmirror_auth_sessions (user_id, expires_at);

CREATE TABLE IF NOT EXISTS mockmirror_user_state (
  user_id uuid PRIMARY KEY REFERENCES mockmirror_users(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
