/* 字段契约检查：防止 SQL 语法过但列不存在（seed 116 行事故）。
 * 1) 从 install.sql 的 create table / add column 提取每张表列名；
 * 2) 核对 seed.sql / install.sql 里 `insert into T (a,b,c)` 的列都在 T 中；
 * 3) 运行时依赖清单：前端依赖的表/列必须能在 install.sql 中找到，
 *    缺失即报错（防止再次出现 matches.event_id 那类事故）。
 * 用法: npm run check:fields
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DDL_FILES = ['supabase/install.sql'];
const CHECK_FILES = ['supabase/seed.sql', 'supabase/install.sql'];

function read(f) {
  const p = path.join(ROOT, f);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

/* 提取 create table 的列名（逐行解析，避免正则跨语句吞并） */
function extractTables(sql, tables) {
  const lines = sql.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/i);
    if (!head) continue;
    const name = head[1].toLowerCase();
    const cols = tables[name] || (tables[name] = new Set());
    if (/like\s+(?:public\.)?"?([a-z0-9_]+)"?/i.test(lines[i])) {
      const src = lines[i].match(/like\s+(?:public\.)?"?([a-z0-9_]+)"?/i)[1].toLowerCase();
      if (tables[src]) tables[src].forEach((c) => cols.add(c));
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (/^\);?$/.test(t) || /^\]\s*as/.test(t)) break;
      if (/^\);?$/.test(t.replace(/;$/, ''))) break;
      /* 一行可有多个列定义（逗号分隔），逐段取首标识符 */
      t.replace(/,$/, '').split(/,(?![^()]*\))/).forEach((seg) => {
        const cm = seg.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+/i);
        if (!cm) return;
        const kw = cm[1].toLowerCase();
        if (['primary', 'unique', 'foreign', 'constraint', 'check', 'references', 'like'].includes(kw)) return;
        cols.add(kw);
      });
    }
  }
  return tables;
}

const tables = {};
DDL_FILES.forEach((f) => extractTables(read(f), tables));
/* alter table X add column Y（schema 后续章节补的列也要算） */
DDL_FILES.forEach((f) => {
  const sql = read(f);
  const re = /alter\s+table\s+(?:public\.)?"?([a-z0-9_]+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  let m;
  while ((m = re.exec(sql))) {
    const t = m[1].toLowerCase();
    if (!tables[t]) tables[t] = new Set();
    tables[t].add(m[2].toLowerCase());
  }
});
/* 动态 DDL 补列（install.sql 用 execute format 动态加的列，静态解析不到，显式登记；
   注意：登记只补解析盲区，下方运行时依赖清单会反过来核对这些列确有保障） */
['s5_matches', 's6_matches'].forEach((t) => {
  if (!tables[t]) tables[t] = new Set();
  tables[t].add('event_id');
  tables[t].add('import_batch_id');
});
['s5_match_schedule', 's6_match_schedule'].forEach((t) => {
  if (!tables[t]) tables[t] = new Set();
  ['result_status', 'submitted_by', 'confirmed_by', 'confirmed_at', 'import_batch_id'].forEach((c) => tables[t].add(c));
});

/* s5_* 表多由 (like s6_*) 生成，补齐镜像 */
Object.keys(tables).filter((t) => t.startsWith('s6_')).forEach((t) => {
  const s5 = 's5_' + t.slice(3);
  if (!tables[s5]) tables[s5] = new Set(tables[t]);
});

/* 运行时依赖清单：前端代码依赖的表/列，install.sql 必须能保障（建表列或补齐段） */
const RUNTIME_TABLES = ['admin_access_codes', 'login_attempts', 'seasons', 'registration_revisions',
  'event_templates', 'import_batches', 'comment_reports', 'team_transfer_requests', 'bet_odds_snapshots'];
const RUNTIME_COLS = {
  s5_matches: ['event_id', 'import_batch_id'], s6_matches: ['event_id', 'import_batch_id'],
  s5_match_schedule: ['result_status', 'import_batch_id'], s6_match_schedule: ['result_status', 'import_batch_id'],
  s6_comments: ['status', 'hidden_by', 'hidden_at', 'hide_reason'],
  goods_redemptions: ['status', 'refund_reason', 'refunded_by', 'refunded_at'],
  events: ['deleted_at', 'organizer_id'],
};
let depErrors = 0;
RUNTIME_TABLES.forEach((t) => {
  if (!tables[t]) { console.error('运行时依赖缺失：表 ' + t + ' 不在 install.sql 中'); depErrors++; }
});
Object.entries(RUNTIME_COLS).forEach(([t, cols]) => {
  cols.forEach((c) => {
    if (!tables[t] || !tables[t].has(c)) { console.error('运行时依赖缺失：' + t + '.' + c); depErrors++; }
  });
});
if (depErrors) { console.error('运行时依赖清单核对失败：' + depErrors + ' 项'); process.exit(1); }

let errors = 0;
let checked = 0;
let skipped = 0;

CHECK_FILES.forEach((f) => {
  const sql = read(f);
  const re = /insert\s+into\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(([^)]*)\)/gi;
  let m;
  while ((m = re.exec(sql))) {
    const table = m[1].toLowerCase();
    const cols = m[2].split(',').map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase()).filter(Boolean);
    if (!tables[table]) { skipped++; continue; }
    checked++;
    cols.forEach((c) => {
      if (!tables[table].has(c)) {
        errors++;
        console.error(`✗ ${f}: 表 ${table} 无列 "${c}"`);
      }
    });
  }
});

/* select 列检查：select a, b from T（仅简单标识符列，含函数/星号跳过） */
let selChecked = 0;
CHECK_FILES.forEach((f) => {
  const sql = read(f);
  const re = /select\s+([a-z0-9_\s,."']+?)\s+from\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;
  let m;
  while ((m = re.exec(sql))) {
    const listRaw = m[1].trim();
    const table = m[2].toLowerCase();
    if (!tables[table]) continue;
    if (listRaw.includes('(') || listRaw.includes('*') || /\bselect\b/i.test(listRaw)) continue;
    const cols = listRaw.split(',').map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase()).filter(Boolean);
    if (!cols.length || cols.some((c) => !/^[a-z_][a-z0-9_]*$/.test(c))) continue;
    selChecked++;
    cols.forEach((c) => {
      if (!tables[table].has(c)) {
        errors++;
        console.error(`✗ ${f}: select 从表 ${table} 取了不存在的列 "${c}"`);
      }
    });
  }
});

console.log(`字段契约：检查 ${checked} 处 insert + ${selChecked} 处 select 列清单，跳过未知表 ${skipped} 处，错误 ${errors}`);
process.exit(errors ? 1 : 0);
