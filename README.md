# Chrome History Tab Manager

A lightweight cross-browser MV3 extension (Chrome + Firefox) for managing currently open tabs by age group.

## Features

- Popup summary for quick cleanup.
- Full dashboard for search, selection, and group actions.
- Hybrid age strategy: recorded open time after install, history-based estimate for existing tabs.
- Bulk close, bookmark, and memory release via `tabs.discard`.
- Dashboard supports two arrangements: **by age** (default) and **by window**. In window mode you can also drag a tab onto another window to move it, or pick a target window from the bulk panel to move the current selection.

## 在 Chrome 中使用

1. 打开 `chrome://extensions`。
2. 开启 **开发者模式**。
3. 点击 **加载已解压的扩展程序**。
4. 选择本项目根目录。
5. 固定扩展图标，打开 popup。

Chrome 直接加载根目录即可，无需任何构建。

### 隐私（无痕）窗口

默认情况下 Chrome 不允许扩展在隐私窗口里运行。要让本扩展在隐私窗口可用，需要两步：

1. `chrome://extensions` → 找到本扩展 → 打开 **在无痕模式下启用**。
2. **重新加载**扩展（隐私模式相关的清单变更需要刷新才生效）。

`manifest.json` 已经声明了 `"incognito": "split"`：这是 Chrome 让 `chrome-extension://` 页面（popup、管理页、快照管理页）能在**隐私窗口标签**里加载的唯一办法——默认的 spanning 模式下 Chrome 会静默拦截这种导航，于是"点 popup 里的管理页按钮什么反应都没有"。split 模式下隐私窗口拥有独立的扩展实例（`storage.local` 仍然共享，这是 Chrome split 的设计），所有功能照常工作。

Firefox 不加这个 key——Firefox 把 `split` 当作 `not_allowed`，但 Firefox 本身没有"spanning 模式下扩展页无法进入隐私标签"那个限制，所以默认就直接可用。

split 模式下另一个连带好处：快照恢复时的懒加载（用本扩展的 `chrome-extension://` 占位页替代每个窗口的非活动标签、只让活动标签真正加载）也能在隐私窗口里正常生效——实测 `windows.create` 的 url 列表里塞 `chrome-extension://` 占位 URL 会被 split 模式的 Chrome 接受，没有"扩展位置已移动"报错。所以隐私窗口里的快照恢复同样享受内存节省，Firefox 行为不变。

### 其他 Chrome 特有行为

- **保存当前窗口**的"当前窗口"判定：在 popup 端用 `tabs.query({active:true, lastFocusedWindow:true})` 解析，不读 service worker 返回的 `currentWindowId`。Chrome MV3 的 service worker 里 `windows.getCurrent` 会给出过期或错位的窗口（隐私 / 普通不分）。Firefox 两边一致。
- **`tabs.discard`（释放标签内存）**：在标签很多时 Chrome 会拒绝一次性释放全部（防止误操作）。代码里的批量释放会自动分批重试。Firefox 没有这个限流。
- **`tabs.move` 跨隐私 / 普通窗口**：会抛 `SkipTabError`，由 `formatActionSummary` 归到"跳过"。这是 Chrome 的硬限制，不修。
- **隐私窗口拒绝 `chrome://` 系列内部页面**：在 Chrome 隐私窗口里 `chrome://extensions`、`chrome://settings`、`chrome://flags` 等浏览器内部页面一律打不开——这是 Chrome 浏览器层面的设计（防止隐私窗口泄露扩展列表、配置等）。`incognito: "split"` 也救不了。如果用户需要在隐私窗口里改本扩展的设置、查看扩展 ID、看其它已装扩展，得**切回普通窗口**操作。Firefox 没有这个限制，`about:addons`、`about:preferences` 等在隐私窗口正常打开。

## 在 Firefox 中使用

Firefox 不能直接加载根目录（根目录的 `manifest.json` 是 Chrome 版）。需要先用脚本把扩展**真实拷贝**组装到 `dist/firefox/`，再从该目录加载。

> 为什么是拷贝而不是软链接：Firefox 的扩展进程在沙箱中读文件，无法可靠解析指向扩展根之外的符号链接（会导致 popup 空白、查看源码为空）。硬链接也不行——它不能链接目录，且编辑器原子保存会断链。因此统一采用"拷贝 + watch 自动重拷"。

### 一次性组装（手动同步）

```bash
npm run dev:firefox
```

然后在 Firefox 中：

1. 打开 `about:debugging#/runtime/this-firefox`。
2. 点击 **临时载入附加组件**。
3. 选择 `dist/firefox/manifest.json`。

改完源码后，重新跑一次 `npm run dev:firefox`，再到扩展卡片上点 **重新加载**。

### Watch 模式（改代码自动同步）

开发时推荐用 watch，免去手动重跑：

```bash
npm run dev:firefox -- --watch
```

它会持续监听 `src/` 和各 HTML 页面，一有改动就自动重新拷贝到 `dist/firefox/`。你只需在 Firefox 扩展卡片上点 **重新加载** 即可看到最新代码（Firefox 不会自动 reload）。按 `Ctrl+C` 停止。

### 永久安装（重启不丢）

`about:debugging` 的临时加载在浏览器重启后会消失。要想长期使用且不丢失数据，用 Firefox Developer Edition 永久安装：

1. 安装 [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/)。
2. 打开 `about:config`，将 `xpinstall.signatures.required` 设为 `false`。
3. 打包：

   ```bash
   npm run pack:firefox
   ```

   生成 `dist/chrome-history-tab-manager-firefox.xpi`。
4. 打开 `about:addons` → 齿轮 → **从文件安装附加组件**，选择该 `.xpi`。

`platforms/firefox/manifest.json` 里固定了 `browser_specific_settings.gecko.id`，因此无论临时加载还是永久安装、重启或重装，扩展 ID 都不变，`storage.local` 里的标签年龄元数据和快照都会保留。

## Development

Run pure module tests:

```bash
npm test
```

Run syntax checks:

```bash
npm run check
```

Assemble / watch the Firefox build:

```bash
npm run dev:firefox            # one-shot sync to dist/firefox
npm run dev:firefox -- --watch # re-sync on change
npm run pack:firefox           # build an unsigned .xpi for permanent install
```
