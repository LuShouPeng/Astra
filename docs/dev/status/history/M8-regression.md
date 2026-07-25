# M8 历史快照 — 回归、文档与 E2E

> 冻结于 M8 实现完成时。前一快照：[`M7-codex-resume.md`](./M7-codex-resume.md)。

| 项         | 值                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 里程碑     | **M8 实现完成** — 跨模块回归、构建验证、状态文档                                                              |
| 日期       | 2026-07-25                                                                                                    |
| 前端测试   | **180/180 通过**（46 files，`--maxWorkers=2`）                                                                |
| 后端测试   | **22/22 通过**                                                                                                |
| 静态检查   | typecheck ✅；ESLint 0 warnings ✅；cargo fmt/check ✅                                                        |
| 生产构建   | ✅ Vite build；仅 620 kB chunk 体积提示                                                                       |
| Playwright | 首轮 **22/24**；两视口同一旧 accessible-name 精确定位失败，定位器已修复；修复后全量重跑授权被拒，未宣称 24/24 |

## 回归补强

- 项目详情 UI 测试覆盖能力过滤、输入任务、创建 live Session 和路由跳转。
- Session 详情 UI 测试覆盖已结束 Codex live Session 的 Resume 操作。
- Playwright 项目详情覆盖 demo 项目启动守卫和侧栏 demo 来源标识。
- 统一测试发现并修复 M6 遗留的业务模块深层导入和未处理 navigation Promise。
- 侧栏新增来源标识改变 link accessible name，E2E 改用稳定标题匹配。

## 剩余验证

允许启动 Edge 后，执行 `npm run test:e2e` 完成修复后的 24 条最终复跑。首轮除上述同一定位器问题外，其余 22 条均通过。
