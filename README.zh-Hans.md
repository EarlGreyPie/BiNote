# BiNote

[한국어](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [繁體中文](README.zh-TW.md) · 简体中文

BiNote 是《玛奇 Mobile》用的 MML 乐谱编辑器，可以在钢琴卷帘或指法谱上写 MML。
每个和弦声部都是一条单独的音轨。可以用多个音色包试听，也能把 MML 优化、拆分，以符合游戏上限（每份乐谱的字数和和弦数）。

**立即使用：[binote.pages.dev](https://binote.pages.dev)**

**《玛奇》**（PC 版）用的乐谱可能会有部分**兼容性问题**，请参考下方“兼容性”一节。

- 形式：TypeScript 网页应用 + PWA（Windows、iPad、Android）
- 输入：钢琴卷帘、指法谱
- 操作：键盘、鼠标、触屏
- 制作：EarlGreyPie

> 这是**非官方的个人粉丝制作工具**，与 Nexon 及《玛奇 Mobile》无关。游戏名称、乐器名称和声音的权利归 Nexon 所有。

## 使用前须知

- **音色包**：没有音色包也可以编辑乐谱。要听到声音，请自行获取玛奇的音色包（.dls）并在应用中加载。音色包属于 Nexon 的资产，BiNote 不包含，本仓库也不分发。
- **存储位置**：乐曲和音色包文件不会上传到任何服务器，只保存在你设备上的浏览器中。应用没有统计或广告脚本。浏览器清理数据时可能会删除它们，想保留的乐曲请保存为项目（.mme）文件。
- **语言**：한국어、English、日本語、繁體中文、简体中文。
- **翻译**：韩语以外的翻译尚未完全经过人工检查。部分名称是临时译名，例如在日本和台湾服务器找不到官方名称的乐器。如发现错误或不自然的文字，请在 [issues](../../issues/new/choose) 中用“翻译反馈”告诉我们。游戏内的官方名称对我们帮助很大。

## 使用方法

[使用指南](docs/guide/zh-Hans.md)介绍界面、输入音符、导出 MML、文件格式和快捷键。

## 测试版计划

测试版地址：[beta.binote.pages.dev](https://beta.binote.pages.dev)

BiNote 另设有测试新功能的测试版页面。
新功能会先在测试版页面测试一段时间，再加入正式页面。

- 测试版页面有仍在测试中的功能，可能不稳定。重要的乐曲请保存为项目（.mme）文件。
- 测试版页面和正式页面的存储空间是分开的。一边的乐曲和音色包在另一边看不到，要转移时请先保存为文件，再到另一边的页面打开。
- 如在测试版页面发现问题，请用 [Beta bug report](../../issues/new?template=beta.yml) 反馈，对开发很有帮助。

## 问题与贡献

- 问题和翻译错误请在 [issues](../../issues/new/choose) 反馈。请附上设置最下方显示的版本，不要附上音色包文件。
- 也欢迎用 issue 提出功能建议。目前不接受代码的 pull request。

## 文件

- **项目（.mme）**：BiNote 自己的格式，用来保留作品。
- **兼容格式**：3MLE .mml、MabiIcco .mmi、MIDI，以及粘贴到游戏里的 `MML@` 文本。

## 兼容性

部分乐谱（连音）可能无法正确带到《玛奇》（PC 版）。不建议用 BiNote 制作给《玛奇》（PC 版）用的复杂乐谱。

> 《玛奇》使用整数 tick。《玛奇 Mobile》也接受分数长度，BiNote 是以分数为基础设计的。因此，部分 MML 在使用整数 tick 的工具或游戏中可能会出错。

## 关于开发

- 策划、游戏实测、QA：EarlGreyPie
- 代码：Claude
- 代码检查：GPT
- 游戏行为以我们在游戏中亲自录音、测量的数值为准。测量资料：乐器音色边界实测报告（[한국어](docs/measure/timbre-boundaries.md)、[日本語](docs/measure/timbre-boundaries.ja.md)）

**与现有工具的关系**

- BiNote 没有使用现有编辑器 3MLE、MabiIcco（mmlTools）的代码，开发时只参考了它们的行为和功能。
- BiNote 计算长度的方式与这些工具不同。我们尽量保持兼容，但并不完美。如发现问题，请在 GitHub 提交 issue。

构建步骤和包结构请见[韩文 README](README.md#개발)。

## 许可

BiNote 以 [GNU GPL v3](LICENSE)（GPL-3.0-only）发布。分发修改版时，必须以相同许可公开其源代码。

- 内含库（SpessaSynth Apache-2.0，CodeMirror、Svelte、VexFlow MIT 等）的声明在 [`apps/web/public/licenses/third-party.txt`](apps/web/public/licenses/third-party.txt)，字体声明（OFL）在 [`fonts.txt`](apps/web/public/licenses/fonts.txt)。
- 《玛奇 Mobile》音色包、乐器名称等游戏资产的权利归 Nexon 所有，不包含在本仓库中。
