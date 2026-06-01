## 1. 页面切换 tab 样式优化

- [ ] 1.1 修改 `resources/chart.html` 中 `.page-tab` 的 CSS 样式：默认颜色改为 `var(--vscode-foreground, #cccccc)`，字重改为 `500`
- [ ] 1.2 修改 `.page-tab:hover` 样式：颜色改为 `var(--vscode-foreground, #ffffff)`，背景色改为 `var(--vscode-list-hoverBackground, rgba(255,255,255,0.08))`
- [ ] 1.3 修改 `.page-tab.active` 样式：颜色改为 `var(--vscode-foreground, #ffffff)`，字重改为 `600`，添加背景色 `var(--vscode-list-activeSelectionBackground, rgba(0,122,204,0.15))`
- [ ] 1.4 修改 `.page-tab-add` 样式：颜色改为 `var(--vscode-foreground, #cccccc)`，悬停时改为 `var(--vscode-foreground, #ffffff)`

## 2. 子变量删除支持

- [ ] 2.1 在 `src/variableTreeDataProvider.ts` 中添加 `findParentPath` 方法，通过路径前缀匹配找到父变量
- [ ] 2.2 修改 `deleteVariable` 方法，允许删除子变量：从缓存中移除子变量，刷新 UI

## 3. 图表时间窗口扩展

- [ ] 3.1 修改 `resources/chart.html` 中 `#selWindow` 下拉菜单，添加 `120s` 选项

## 4. 图表高频刷新支持

- [ ] 4.1 修改 `resources/chart.html` 中 `#selInterval` 下拉菜单，添加 `20ms` 选项并设为默认
- [ ] 4.2 修改 `resources/chart.js` 中 `collectInterval` 默认值为 `20`

## 5. 调色板优化

- [ ] 5.1 修改 `resources/chart.js` 中 `COLORS` 数组，使用高对比度调色板
- [ ] 5.2 修改 `src/chartManager.ts` 中 `CHART_COLORS` 数组，保持一致性

## 6. 验证

- [ ] 6.1 运行 `npm run compile` 验证编译通过
- [ ] 6.2 测试页面切换 tab 样式是否符合预期
- [ ] 6.3 测试子变量删除功能是否正常
- [ ] 6.4 测试 120s 时间窗口是否正常工作
- [ ] 6.5 测试 20ms 刷新频率是否正常工作
- [ ] 6.6 测试新调色板是否显示正确
