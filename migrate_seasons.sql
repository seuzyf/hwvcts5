-- HWVCTS 赛季数据表迁移脚本
-- 用于将现有数据复制到带 s5_ 和 s6_ 前缀的新表中

-- ============================================
-- 第一步：将现有表重命名为 s5_ 前缀（S5 赛季数据）
-- ============================================

-- 备份 matches 表到 s5_matches
CREATE TABLE IF NOT EXISTS s5_matches (LIKE matches INCLUDING ALL);
INSERT INTO s5_matches SELECT * FROM matches;

-- 备份 player_ids 表到 s5_player_ids
CREATE TABLE IF NOT EXISTS s5_player_ids (LIKE player_ids INCLUDING ALL);
INSERT INTO s5_player_ids SELECT * FROM player_ids;

-- ============================================
-- 第二步：创建 s6_ 前缀的新表（S6 赛季空表）
-- ============================================

-- 创建 s6_matches 表（与 matches 结构相同）
CREATE TABLE IF NOT EXISTS s6_matches (
    id SERIAL PRIMARY KEY,
    match_date TIMESTAMP WITH TIME ZONE,
    stage TEXT,
    "group" TEXT,
    map TEXT,
    team_a TEXT,
    team_b TEXT,
    score TEXT,
    winner TEXT,
    team_a_player1_id TEXT,
    team_a_player1_ch TEXT,
    team_a_player1_data TEXT,
    team_a_player2_id TEXT,
    team_a_player2_ch TEXT,
    team_a_player2_data TEXT,
    team_a_player3_id TEXT,
    team_a_player3_ch TEXT,
    team_a_player3_data TEXT,
    team_a_player4_id TEXT,
    team_a_player4_ch TEXT,
    team_a_player4_data TEXT,
    team_a_player5_id TEXT,
    team_a_player5_ch TEXT,
    team_a_player5_data TEXT,
    team_b_player1_id TEXT,
    team_b_player1_ch TEXT,
    team_b_player1_data TEXT,
    team_b_player2_id TEXT,
    team_b_player2_ch TEXT,
    team_b_player2_data TEXT,
    team_b_player3_id TEXT,
    team_b_player3_ch TEXT,
    team_b_player3_data TEXT,
    team_b_player4_id TEXT,
    team_b_player4_ch TEXT,
    team_b_player4_data TEXT,
    team_b_player5_id TEXT,
    team_b_player5_ch TEXT,
    team_b_player5_data TEXT
);

-- 创建 s6_player_ids 表（与 player_ids 结构相同）
CREATE TABLE IF NOT EXISTS s6_player_ids (
    name TEXT PRIMARY KEY,
    id TEXT,
    team TEXT,
    "group" TEXT,
    image TEXT,
    honor TEXT,
    pwd TEXT
);

-- ============================================
-- 说明：
-- 1. 执行此脚本后：
--    - 原 matches 表数据已复制到 s5_matches（S5 赛季历史数据）
--    - 原 player_ids 表数据已复制到 s5_player_ids（S5 赛季选手数据）
--    - s6_matches 和 s6_player_ids 为空表，用于 S6 赛季新数据
-- 
-- 2. 后续如需切换赛季，只需在代码中更改 currentSeason 变量
--    - currentSeason = 's5' 时使用 s5_matches 和 s5_player_ids
--    - currentSeason = 's6' 时使用 s6_matches 和 s6_player_ids
--
-- 3. 如需将 S6 数据也保留，可手动插入或等待赛季结束后执行类似备份操作
-- ============================================
