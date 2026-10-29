-- 面镜 MockMirror · Neon 持久化
-- 应用启动时会自动执行；也可以在 Neon SQL Editor 手动执行。
CREATE TABLE IF NOT EXISTS mockmirror_state (
  id smallint PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);
