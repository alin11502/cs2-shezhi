/**
 * 站点数据访问层。读 scripts/fetch-data.mjs 产出的 src/data/*.json，建好索引。
 *
 * 用 import.meta.glob 而不是静态 import：src/data/ 被 gitignore，全新 clone 时
 * 这些文件根本不存在，静态 import 会让 astro build 直接失败。glob 在文件缺失时
 * 返回空对象，于是全站优雅降级成"数据库建设中"的空态。
 *
 * 所有导出的读取函数都不抛异常，缺数据一律返回空数组 / undefined，
 * 让页面自己决定怎么呈现空态。
 */

import { pbFileUrl } from "../config";
import type {
  DataMeta,
  Keybind,
  Player,
  PlayerSettings,
  SiteData,
  Snapshot,
  Team,
  Tenure,
} from "./types";

const modules = import.meta.glob("../data/*.json", { eager: true }) as Record<
  string,
  { default?: unknown }
>;

function readArray<T>(name: string): T[] {
  const mod = modules[`../data/${name}.json`];
  const value = mod?.default;
  return Array.isArray(value) ? (value as T[]) : [];
}

function readMeta(): DataMeta {
  const mod = modules["../data/meta.json"];
  const value = mod?.default as Partial<DataMeta> | undefined;
  return {
    fetched_at: value?.fetched_at ?? "",
    pb_url: value?.pb_url ?? "",
    stale: value?.stale ?? true,
    // 没有 meta.json 就是从没成功取过数据
    empty: value?.empty ?? true,
    counts: value?.counts ?? {},
  };
}

const rawTeams = readArray<Team>("teams");
const rawPlayers = readArray<Player>("players");
const rawTenures = readArray<Tenure>("tenures");
const rawSnapshots = readArray<Snapshot>("snapshots");
const rawSettings = readArray<PlayerSettings>("settings");
const rawKeybinds = readArray<Keybind>("keybinds");

/** 头像/队标在这里统一补前缀，页面拿到的就是可直接用的 URL */
export const teams: Team[] = rawTeams.map((t) => ({ ...t, logo_url: pbFileUrl(t.logo_url) }));
export const players: Player[] = rawPlayers.map((p) => ({ ...p, avatar_url: pbFileUrl(p.avatar_url) }));
export const tenures: Tenure[] = rawTenures;
export const snapshots: Snapshot[] = rawSnapshots;
export const settings: PlayerSettings[] = rawSettings;
export const keybinds: Keybind[] = rawKeybinds;
export const meta: DataMeta = readMeta();

// ---------- 索引 ----------

function indexBy<T>(rows: T[], key: (row: T) => string | null): Map<string, T> {
  const m = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    if (k && !m.has(k)) m.set(k, row);
  }
  return m;
}

function groupBy<T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    const bucket = m.get(k);
    if (bucket) bucket.push(row);
    else m.set(k, [row]);
  }
  return m;
}

const playerBySlug = indexBy(players, (p) => p.slug);
const playerById = indexBy(players, (p) => p.id);
const teamBySlug = indexBy(teams, (t) => t.slug);

const snapshotsByPlayer = groupBy(snapshots, (s) => s.player_id);
const tenuresByPlayer = groupBy(tenures, (t) => t.player_id);
const keybindsByPlayer = groupBy(keybinds, (k) => k.player_id);
const settingsByPlayer = indexBy(settings, (s) => s.player_id);

// snapshots 已按 -captured_at 排序，第一条 is_current 即当前准星
const currentByPlayer = new Map<string, Snapshot>();
for (const s of snapshots) {
  if (s.is_current && !currentByPlayer.has(s.player_id)) currentByPlayer.set(s.player_id, s);
}

// ---------- 查询接口 ----------

export function getPlayer(slug: string): Player | undefined {
  return playerBySlug.get(slug);
}

export function getPlayerById(id: string): Player | undefined {
  return playerById.get(id);
}

export function getTeam(slug: string): Team | undefined {
  return teamBySlug.get(slug);
}

export function getCurrentCrosshair(playerId: string): Snapshot | undefined {
  return currentByPlayer.get(playerId);
}

/** 选手的准星历史，按 captured_at 倒序（最新在前） */
export function getCrosshairHistory(playerId: string): Snapshot[] {
  return snapshotsByPlayer.get(playerId) ?? [];
}

export function getSettings(playerId: string): PlayerSettings | undefined {
  return settingsByPlayer.get(playerId);
}

/** 转会史，按 start_date 正序（时间线从上到下） */
export function getTenures(playerId: string): Tenure[] {
  const rows = tenuresByPlayer.get(playerId) ?? [];
  return [...rows].sort((a, b) => String(a.start_date ?? "").localeCompare(String(b.start_date ?? "")));
}

export function getKeybinds(playerId: string): Keybind[] {
  return keybindsByPlayer.get(playerId) ?? [];
}

/**
 * 列表页用的选手：只保留有当前准星的，并按 sort_order、name 排。
 * 没有准星的选手档案对"准星站"没有展示价值，放进列表只会稀释点击。
 */
export function listPlayersWithCrosshair(): Player[] {
  return players
    .filter((p) => currentByPlayer.has(p.id))
    .sort(
      (a, b) =>
        (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.name.localeCompare(b.name, "zh-Hans-CN")
    );
}

/** 全部选手，用于 /players/ 列表页（含尚无准星的档案） */
export function listAllPlayers(): Player[] {
  return [...players].sort(
    (a, b) =>
      (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.name.localeCompare(b.name, "zh-Hans-CN")
  );
}

/** 去重后的准星码 → 用它的选手。/crosshair/[code]/ 页用。 */
export function listDistinctCodes(): { code: string; snapshots: Snapshot[] }[] {
  const byCode = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    if (!s.code) continue;
    const bucket = byCode.get(s.code);
    if (bucket) bucket.push(s);
    else byCode.set(s.code, [s]);
  }
  return [...byCode.entries()]
    .map(([code, list]) => ({ code, snapshots: list }))
    .sort((a, b) => b.snapshots.length - a.snapshots.length || a.code.localeCompare(b.code));
}

export function getSnapshotsByCode(code: string): Snapshot[] {
  return snapshots.filter((s) => s.code === code);
}

// ---------- 站点级状态 ----------

export const counts = {
  players: players.length,
  playersWithCrosshair: listPlayersWithCrosshair().length,
  teams: teams.length,
  snapshots: snapshots.length,
  distinctCodes: new Set(snapshots.map((s) => s.code).filter(Boolean)).size,
  settings: settings.length,
  keybinds: keybinds.length,
  tenures: tenures.length,
};

/**
 * 聚合统计（/best/* 页）的最低样本量门槛。
 * 低于这个数就整块隐藏统计、改显示"数据库建设中"——
 * 用 5 个样本画分布图是自欺，也会误导用户。
 */
export const MIN_SAMPLE_FOR_STATS = 8;

export function hasEnoughSample(n: number): boolean {
  return n >= MIN_SAMPLE_FOR_STATS;
}

/** 数据库是否为空（决定全站是否呈现"建设中"空态） */
export const isEmpty = counts.players === 0 && counts.snapshots === 0;

/** 数据新鲜度提示文案，页面顶部用 */
export function freshnessNote(): string | null {
  if (!meta.fetched_at) return "数据尚未同步";
  if (meta.empty) return "数据库建设中，尚未收录任何选手";
  if (meta.stale) return `数据取自本地缓存（${meta.fetched_at.slice(0, 10)}），PocketBase 当时不可达`;
  return null;
}

export function siteData(): SiteData {
  return { meta, teams, players, tenures, snapshots, settings, keybinds };
}
