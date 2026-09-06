/**
 * 站点侧的数据类型。字段名与 server/pb_migrations 严格对应，
 * 但形状是 fetch-data.mjs **裁剪并扁平化之后**的结果：
 * 去掉了 raw_json / sampled_ticks 等大字段，relation 的 expand 结果拍平成内联对象。
 *
 * ⚠ 这里曾经声称"故意不给 split_distance / inner_split_alpha / outer_split_alpha /
 * split_size_ratio 留位置，因为准星码不携带它们、解码器永远返回引擎默认值"。
 * **该论断已被源码与实测双重证伪**：这 4 项编码在 bytes[8]/[10]/[11]，
 * 真实码解出的是 3/0.1/1/1 而非默认值，原样重编码可字节级还原。
 * 它们是动态准星（style=4）的分裂行为参数，属于选手的真实设置，现已全部纳入。
 */

/** PocketBase 记录都有的 id。注意这些表**没有** created/updated autodate 字段。 */
interface PbBase {
  id: string;
}

export type Region = "eu" | "na" | "cis" | "br" | "asia" | "oce" | "mena" | "sa" | "other";
export type PlayerStatus = "active" | "inactive" | "retired";
export type PlayerRole = "awper" | "rifler" | "igl" | "support" | "entry" | "lurker";
export type TenureRole = PlayerRole | "coach";

/** 数据来源。前台必须如实标注，不能让用户误以为全是自动提取的。 */
export type DataSource = "demo" | "manual" | "player_published" | "third_party" | "stream";
export type Confidence = "high" | "medium" | "low";

/** 溯源信息。每个展示设置的区块都应带上这些字段。 */
export interface Provenance {
  source: DataSource | null;
  confidence: Confidence | null;
  evidence_url: string | null;
}

export interface Team extends PbBase {
  name: string;
  slug: string;
  tag: string | null;
  region: Region | null;
  /** 已解析好的 logo URL，为空表示没有图 */
  logo_url: string | null;
  active: boolean;
}

export interface Player extends PbBase {
  slug: string;
  name: string;
  real_name: string | null;
  /** ISO 3166-1 alpha-2，前台渲染国旗 */
  country: string | null;
  steamid64: string | null;
  avatar_url: string | null;
  hltv_id: number | null;
  status: PlayerStatus | null;
  role: PlayerRole | null;
  sort_order: number | null;
  /** current_team 的 expand 结果，拍平成内联对象 */
  team: { id: string; name: string; slug: string; tag: string | null } | null;
}

export interface Tenure extends PbBase {
  player_id: string;
  player_name: string;
  team_id: string;
  team_name: string;
  team_slug: string;
  role: TenureRole | null;
  start_date: string | null;
  /** 为空表示当前仍在队 */
  end_date: string | null;
  source_url: string | null;
}

/** snapshot 里内联的 demo 摘要。整张 demos 表不拉，只取前台要用的几项。 */
export interface DemoSummary {
  event: string | null;
  map: string | null;
  match_date: string | null;
  sharecode: string | null;
  team_a: string | null;
  team_b: string | null;
}

/**
 * 准星码携带的全部 21 项参数。
 * 与 cli/src/crosshair.js 的 ENCODED_FIELDS 一一对应，有差分测试守护。
 */
export interface CrosshairParams {
  /** 0=默认 1=静态(经典) 2=经典 3=内缩(准) 4=动态 */
  style: number;
  length: number;
  thickness: number;
  gap: number;
  /** 颜色索引；落入自定义档位时读 red/green/blue */
  color: number;
  red: number;
  green: number;
  blue: number;
  alpha_enabled: boolean;
  alpha: number;
  outline_enabled: boolean;
  outline: number;
  center_dot_enabled: boolean;
  follow_recoil: boolean;
  fixed_crosshair_gap: number;
  t_style_enabled: boolean;
  deployed_weapon_gap_enabled: boolean;
  /**
   * 动态准星（style=4）的分裂行为参数。静态样式下不影响外观，
   * 但它们确实编码在码里（bytes[8]/[10]/[11]），是选手的真实设置。
   */
  /** 分裂距离，域 0–7 */
  split_distance: number;
  /** 内段透明度系数，域 0–1.5，步进 0.1 */
  inner_split_alpha: number;
  /** 外段透明度系数，域 0–1.5，步进 0.1 */
  outer_split_alpha: number;
  /** 最大分裂比，域 0–1.5，步进 0.1 */
  split_size_ratio: number;
}

/** 持枪视角。不在准星码里，由 demo 直接提取，可能整体为空。 */
export interface Viewmodel {
  viewmodel_fov: number | null;
  viewmodel_offset_x: number | null;
  viewmodel_offset_y: number | null;
  viewmodel_offset_z: number | null;
  viewmodel_presetpos: number | null;
}

export interface Snapshot extends PbBase, CrosshairParams, Viewmodel, Provenance {
  player_id: string;
  player_slug: string;
  player_name: string;
  /** 准星码原值，是这个版本的天然指纹 */
  code: string;
  is_current: boolean;
  captured_at: string | null;
  last_seen_at: string | null;
  batch: string | null;
  demo: DemoSummary | null;
  last_seen_demo: DemoSummary | null;
}

export type AspectRatio = "4:3" | "16:9" | "16:10" | "5:4" | "21:9";
export type ScalingMode = "stretch" | "black_bars" | "aspect";
export type DisplayMode = "fullscreen" | "borderless" | "windowed";

/**
 * 全套游戏设置。这些字段 demo 里**都没有**，只能人工录入或取自第三方，
 * 所以 Provenance 是必填关注点，前台必须标注来源与核对时间。
 */
export interface PlayerSettings extends PbBase, Provenance {
  player_id: string;
  player_slug: string;
  player_name: string;

  sensitivity: number | null;
  dpi: number | null;
  /** eDPI = sensitivity × dpi，入库时已算好 */
  edpi: number | null;
  zoom_sensitivity: number | null;
  windows_sensitivity: number | null;
  polling_rate: number | null;
  raw_input: boolean | null;

  resolution: string | null;
  aspect_ratio: AspectRatio | null;
  scaling_mode: ScalingMode | null;
  refresh_rate: number | null;
  brightness: number | null;
  display_mode: DisplayMode | null;
  multisampling: number | null;
  boost_player_contrast: "enabled" | "disabled" | null;

  mouse: string | null;
  mousepad: string | null;
  keyboard: string | null;
  headset: string | null;
  monitor: string | null;

  launch_options: string | null;
  notes: string | null;
  /** 人工录入的数据会过时，前台据此提示"核关于 X" */
  verified_at: string | null;
}

export interface Keybind extends PbBase {
  player_id: string;
  player_name: string;
  action: string;
  key: string;
  raw_command: string | null;
  source_url: string | null;
}

/** fetch-data.mjs 写出的 meta.json */
export interface DataMeta {
  fetched_at: string;
  pb_url: string;
  /** PocketBase 不可达、正在复用旧缓存时为 true */
  stale: boolean;
  /** 从未成功取到数据、写的是空骨架时为 true */
  empty: boolean;
  counts: Record<string, number>;
}

/** 所有 JSON 的合集，data.ts 的返回形状 */
export interface SiteData {
  meta: DataMeta;
  teams: Team[];
  players: Player[];
  tenures: Tenure[];
  snapshots: Snapshot[];
  settings: PlayerSettings[];
  keybinds: Keybind[];
}
