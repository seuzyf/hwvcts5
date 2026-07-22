-- ===========================================
-- 赛季数据迁移脚本
-- 功能：将现有表格重命名为 s5 前缀，并创建新的 s6 空表格
-- ===========================================

-- 1. 重命名现有表格为 s5 前缀
ALTER TABLE IF EXISTS matches RENAME TO s5_matches;
ALTER TABLE IF EXISTS player_ids RENAME TO s5_player_ids;
ALTER TABLE IF EXISTS match_schedule RENAME TO s5_match_schedule;
ALTER TABLE IF EXISTS comments RENAME TO s5_comments;
ALTER TABLE IF EXISTS player_stats RENAME TO s5_player_stats;

-- 2. 创建新的 s6 赛季空表格（只保留表结构）

-- s6_matches 表
CREATE TABLE IF NOT EXISTS s6_matches (
    id SERIAL PRIMARY KEY,
    match_id TEXT UNIQUE,
    game_id TEXT,
    map TEXT,
    winner TEXT,
    loser TEXT,
    winner_score INTEGER,
    loser_score INTEGER,
    stage TEXT,
    group_name TEXT,
    round INTEGER,
    team_a_players TEXT[],
    team_b_players TEXT[],
    team_a_side TEXT,
    team_b_side TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- s6_player_ids 表
CREATE TABLE IF NOT EXISTS s6_player_ids (
    name TEXT PRIMARY KEY,
    id TEXT,
    team TEXT,
    "group" TEXT,
    image TEXT,
    pwd TEXT,
    honor TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- s6_match_schedule 表
CREATE TABLE IF NOT EXISTS s6_match_schedule (
    match_id TEXT PRIMARY KEY,
    "group" TEXT,
    match_date TIMESTAMP,
    home_team TEXT,
    away_team TEXT,
    venue TEXT,
    commentators TEXT[],
    link TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- s6_comments 表
CREATE TABLE IF NOT EXISTS s6_comments (
    id SERIAL PRIMARY KEY,
    player_key TEXT,
    author TEXT,
    content TEXT,
    rating INTEGER,
    ip_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    parent_id INTEGER REFERENCES s6_comments(id)
);

-- s6_player_stats 表
CREATE TABLE IF NOT EXISTS s6_player_stats (
    id SERIAL PRIMARY KEY,
    player_name TEXT,
    game_id TEXT,
    pre_group TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_s6_matches_match_id ON s6_matches(match_id);
CREATE INDEX IF NOT EXISTS idx_s6_matches_stage ON s6_matches(stage);
CREATE INDEX IF NOT EXISTS idx_s6_matches_group ON s6_matches(group_name);
CREATE INDEX IF NOT EXISTS idx_s6_player_ids_team ON s6_player_ids(team);
CREATE INDEX IF NOT EXISTS idx_s6_player_ids_group ON s6_player_ids("group");
CREATE INDEX IF NOT EXISTS idx_s6_comments_player_key ON s6_comments(player_key);
