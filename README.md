# CS2 职业选手设置与准星

纯中文 CS2 职业选手准星与游戏设置内容站。静态生成（Astro），服务器只吐 HTML；
准星预览、参数表、CFG 全部构建时内联，**禁用 JavaScript 也能完整看到全部内容**。

## 结构

| 目录 | 内容 |
|---|---|
| `site/` | Astro 7 静态前端 + Tailwind v4 + daisyUI 5；Svelte island 只用于交互工具 |
| `server/` | PocketBase 后端：collection schema（pb_migrations）+ 导入端点（pb_hooks） |
| `cli/` | `cs2cx` 本地工具：从 CS2 demo 提取准星码、解码、导出、导入 |
| `deploy/` | Caddyfile、systemd unit、VPS 初始化 / 部署 / 备份脚本 |

## 本地跑起来

```bash
# 1. 后端（PocketBase 0.40.2，迁移在启动时自动应用）
server/dev.sh start            # 首次需创建超级用户：
                               # .tools/pocketbase/pocketbase.exe superuser upsert <邮箱> <密码> --dir=server/pb_data

# 2. 灌数据
cd site
node scripts/seed.mjs                                   # 10 名虚构样本（有准星，明确标注）
node scripts/fetch-prosettings.mjs s1mple donk zywoo    # 抓真实选手设置（只设置、不含准星）
node scripts/seed.mjs --file scripts/seed/prosettings-draft.json   # 审过草稿后入库

# 3. 前端
npm run build && npm run preview     # build 会先生成 OG 图再构建
```

`server/dev.sh` 必须显式传 `--dir/--migrationsDir/--hooksDir`：PocketBase 0.40 这三个
路径默认相对**可执行文件所在目录**解析，而二进制在 `.tools/pocketbase/`、schema 在
`server/`，不显式传就会在 `.tools/` 下静默建一个空库、一个迁移都不跑。

## 数据从哪来（以及不从哪来）

- **准星**：只来自比赛 demo 提取（`cs2cx extract`，高置信）或选手本人发布的码。
  **不从 prosettings 抓准星** —— 它的页面正文没有准星码（码全在评论区），
  且展示值→`cl_crosshairstyle` 的映射无法可靠验证。
- **设置/外设/视频**：prosettings.net 展示值，`source=third_party`、
  `confidence=medium`、每条带证据链接与核对日期。
- **HLTV 不用**：没有这些数据的公开接口，选手页有 Cloudflare 防护，
  且其服务条款明文禁止抓取与"构建同类竞争网站"。
- 每条数据前台都带来源徽章；样本数据明确标注"虚构样本"。

## 两条必须知道的数据事实

1. **准星码携带 21 项参数**，不是 17。`split_distance / inner_split_alpha /
   outer_split_alpha / split_size_ratio` 编码在 bytes[8]/[10]/[11]，是动态准星
   （style=4）的分裂行为参数；静态样式下不影响外观但仍是选手的真实设置。
   （早期版本误判它们"不在码里"，已更正，见 `server/pb_migrations/1756900400_*`。）
2. **准星码对超范围输入静默回绕**（length 30 → 4.4、style 9 → 污染 center_dot 位）。
   所有生成码的路径都先钳制 + 向零截断，再 decode 回读断言 21 项一致，不一致不出码。

## 验证

```bash
cd site && npm test          # 147 项单测（几何/钳制/PSA 收敛/匹配/推荐规则）
npm run check-dist           # 24 项构建产物断言（结构/SEO/无JS可见/文案红线）
cd ../cli && npm test        # demo 归并逻辑单测
npm run test:integration     # 导入端点集成测试（需运行中的 PocketBase）
```

## 部署

```bash
sudo bash deploy/setup-vps.sh   # VPS 一次性初始化（建用户/目录、校验和下载 PocketBase、装 Caddy）
bash deploy/deploy.sh           # 本机构建并上传静态产物
```

## 已知未做

- Lighthouse 跑分（开发机无 Chrome/lighthouse）
- 准星几何的实机校准：`effectiveGap` 与颜色预设值需游戏内截图对照
- `cs2cx extract` 的真实 demo 验证（需要一个 `.dem` 文件）
- 真实选手的准星（需 demo 提取或选手本人发布的码；prosettings 不提供可靠准星）
