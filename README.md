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
