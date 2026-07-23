-- HWVCTS S5 赛季数据表迁移脚本
-- 此脚本用于将现有的 matches 和 player_ids 表复制为 s5_matches 和 s5_player_ids 表
-- 执行此脚本前，请确保您已备份重要数据

-- 1. 创建 s5_player_ids 表（复制 player_ids 表结构和数据）
CREATE TABLE IF NOT EXISTS s5_player_ids (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    team TEXT,
    "group" TEXT,
    pwd TEXT,
    image TEXT,
    honor TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 2. 将现有 player_ids 数据复制到 s5_player_ids
INSERT INTO s5_player_ids (id, name, team, "group", pwd, image, honor, created_at)
SELECT id, name, team, "group", pwd, image, honor, created_at
FROM player_ids
ON CONFLICT (id) DO NOTHING;

-- 3. 创建 s5_matches 表（复制 matches 表结构和数据）
CREATE TABLE IF NOT EXISTS s5_matches (
    id SERIAL PRIMARY KEY,
    "group" TEXT NOT NULL,
    stage TEXT NOT NULL,
    match_date TEXT NOT NULL,
    map TEXT NOT NULL,
    team_a TEXT NOT NULL,
    team_b TEXT NOT NULL,
    score TEXT,
    team_a_player1_id TEXT,
    team_a_player1_data TEXT,
    team_a_player1_ch TEXT,
    team_a_player2_id TEXT,
    team_a_player2_data TEXT,
    team_a_player2_ch TEXT,
    team_a_player3_id TEXT,
    team_a_player3_data TEXT,
    team_a_player3_ch TEXT,
    team_a_player4_id TEXT,
    team_a_player4_data TEXT,
    team_a_player4_ch TEXT,
    team_a_player5_id TEXT,
    team_a_player5_data TEXT,
    team_a_player5_ch TEXT,
    team_b_player1_id TEXT,
    team_b_player1_data TEXT,
    team_b_player1_ch TEXT,
    team_b_player2_id TEXT,
    team_b_player2_data TEXT,
    team_b_player2_ch TEXT,
    team_b_player3_id TEXT,
    team_b_player3_data TEXT,
    team_b_player3_ch TEXT,
    team_b_player4_id TEXT,
    team_b_player4_data TEXT,
    team_b_player4_ch TEXT,
    team_b_player5_id TEXT,
    team_b_player5_data TEXT,
    team_b_player5_ch TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 4. 将现有 matches 数据复制到 s5_matches
INSERT INTO s5_matches (
    "group", stage, match_date, map, team_a, team_b, score,
    team_a_player1_id, team_a_player1_data, team_a_player1_ch,
    team_a_player2_id, team_a_player2_data, team_a_player2_ch,
    team_a_player3_id, team_a_player3_data, team_a_player3_ch,
    team_a_player4_id, team_a_player4_data, team_a_player4_ch,
    team_a_player5_id, team_a_player5_data, team_a_player5_ch,
    team_b_player1_id, team_b_player1_data, team_b_player1_ch,
    team_b_player2_id, team_b_player2_data, team_b_player2_ch,
    team_b_player3_id, team_b_player3_data, team_b_player3_ch,
    team_b_player4_id, team_b_player4_data, team_b_player4_ch,
    team_b_player5_id, team_b_player5_data, team_b_player5_ch,
    created_at
)
SELECT 
    "group", stage, match_date, map, team_a, team_b, score,
    team_a_player1_id, team_a_player1_data, team_a_player1_ch,
    team_a_player2_id, team_a_player2_data, team_a_player2_ch,
    team_a_player3_id, team_a_player3_data, team_a_player3_ch,
    team_a_player4_id, team_a_player4_data, team_a_player4_ch,
    team_a_player5_id, team_a_player5_data, team_a_player5_ch,
    team_b_player1_id, team_b_player1_data, team_b_player1_ch,
    team_b_player2_id, team_b_player2_data, team_b_player2_ch,
    team_b_player3_id, team_b_player3_data, team_b_player3_ch,
    team_b_player4_id, team_b_player4_data, team_b_player4_ch,
    team_b_player5_id, team_b_player5_data, team_b_player5_ch,
    created_at
FROM matches;

-- 5. 为 s5_matches 表添加索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_s5_matches_group ON s5_matches("group");
CREATE INDEX IF NOT EXISTS idx_s5_matches_stage ON s5_matches(stage);
CREATE INDEX IF NOT EXISTS idx_s5_matches_date ON s5_matches(match_date);

-- 6. 为 s5_player_ids 表添加索引
CREATE INDEX IF NOT EXISTS idx_s5_player_ids_group ON s5_player_ids("group");
CREATE INDEX IF NOT EXISTS idx_s5_player_ids_team ON s5_player_ids(team);

-- 验证数据迁移
SELECT 's5_player_ids' AS table_name, COUNT(*) AS row_count FROM s5_player_ids
UNION ALL
SELECT 's5_matches' AS table_name, COUNT(*) AS row_count FROM s5_matches;

-- 完成提示
-- 现在您可以在 index.html 中使用赛季切换功能：
-- - 点击 S6 按钮：使用 matches 和 player_ids 表（新数据）
-- - 点击 S5 按钮：使用 s5_matches 和 s5_player_ids 表（历史数据）
