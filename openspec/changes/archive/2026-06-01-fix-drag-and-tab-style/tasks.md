## 1. 移除拖拽限制

- [ ] 1.1 删除 `src/variableTreeDataProvider.ts` 中 `handleDrop` 方法的 `hasChildren` 检查

## 2. 改进页面切换tab样式

- [ ] 2.1 修改 `resources/chart.html` 中 `.page-tab` 样式，使用固定颜色：背景 #3c3c3c，文字 #ffffff
- [ ] 2.2 修改 `.page-tab:hover` 样式，背景 #505050，文字 #ffffff
- [ ] 2.3 修改 `.page-tab.active` 样式，背景 #007acc，文字 #ffffff
- [ ] 2.4 修改 `.page-tab-add` 样式，与tab保持一致

## 3. 验证

- [ ] 3.1 运行 `npm run compile` 验证编译通过
- [ ] 3.2 测试拖出结构体功能
- [ ] 3.3 测试拖出类功能
- [ ] 3.4 测试拖出数组功能
- [ ] 3.5 测试页面切换tab样式是否可见
