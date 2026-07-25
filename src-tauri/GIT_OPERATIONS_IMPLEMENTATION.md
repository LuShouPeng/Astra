# Git 写操作功能实现文档

## 概述

本文档描述了在 Astra Nexus Workbench 中实现的 Git 写操作功能，包括 Commit、Merge、Reset、Checkout 以及自动 Worktree 管理和真实评审操作写回仓库的能力。

## 实现的功能

### 1. Git Commit（提交）
- **后端实现**: `src-tauri/src/modules/project.rs` - `git_commit()` 函数
- **前端接口**: `src/modules/changes/services/changesService.ts` - `commit()` 方法
- **功能特性**:
  - 支持提交所有更改或指定文件
  - 支持自定义作者名称和邮箱
  - 自动从 git 配置读取作者信息
  - 返回提交 ID 和分支名称

**使用示例**:
```typescript
const result = await changesService.commit(project, {
  message: "Fix bug in user authentication",
  filePaths: ["src/auth.ts"], // 可选：指定文件，否则提交所有更改
});
console.log(`Committed ${result.commitId} to ${result.branch}`);
```

### 2. Git Checkout（切换分支）
- **后端实现**: `src-tauri/src/modules/project.rs` - `git_checkout()` 函数
- **前端接口**: `src/modules/changes/services/changesService.ts` - `checkout()` 方法
- **功能特性**:
  - 切换到现有分支
  - 创建并切换到新分支
  - 支持 detached HEAD 状态

**使用示例**:
```typescript
// 切换到现有分支
await changesService.checkout(project, {
  branchName: "feature/new-feature",
  createNew: false,
});

// 创建并切换到新分支
await changesService.checkout(project, {
  branchName: "feature/another-feature",
  createNew: true,
});
```

### 3. Git Merge（合并分支）
- **后端实现**: `src-tauri/src/modules/project.rs` - `git_merge()` 函数
- **前端接口**: `src/modules/changes/services/changesService.ts` - `merge()` 方法
- **功能特性**:
  - 支持 fast-forward 合并
  - 支持普通合并（创建合并提交）
  - 检测并报告合并冲突
  - 自动处理无需合并的情况（已是最新）

**使用示例**:
```typescript
const result = await changesService.merge(project, {
  branchName: "feature/to-merge",
});

if (result.success) {
  console.log("Merge successful");
} else {
  console.log("Conflicts in:", result.conflicts);
}
```

### 4. Git Reset（重置）
- **后端实现**: `src-tauri/src/modules/project.rs` - `git_reset()` 函数
- **前端接口**: `src/modules/changes/services/changesService.ts` - `reset()` 方法
- **功能特性**:
  - 支持三种重置类型：soft、mixed、hard
  - 可重置到 HEAD 或指定的提交 ID
  - Soft: 保留暂存区和工作目录的更改
  - Mixed: 保留工作目录更改，清空暂存区
  - Hard: 丢弃所有更改

**使用示例**:
```typescript
// 重置到 HEAD (mixed)
await changesService.reset(project, {
  resetType: "mixed",
});

// 重置到指定提交 (hard)
await changesService.reset(project, {
  commitId: "abc123def456",
  resetType: "hard",
});
```

### 5. Git Worktree 管理
- **后端实现**: `src-tauri/src/modules/project.rs` - `git_worktree_*()` 函数
- **前端接口**: `src/modules/changes/services/changesService.ts` - `worktree*()` 方法
- **功能特性**:
  - 列出所有 worktree
  - 创建新的 worktree
  - 删除 worktree
  - 自动管理 worktree 目录（在项目根目录下的 `.worktrees/` 文件夹）

**使用示例**:
```typescript
// 列出所有 worktree
const worktrees = await changesService.worktreeList(project);

// 创建新 worktree
const newWorktree = await changesService.worktreeCreate(project, {
  name: "feature-work",
  branchName: "feature/new-branch", // 可选：默认使用 name
});

// 删除 worktree
await changesService.worktreeRemove(project, "feature-work");
```

### 6. UI 组件 - GitOperations
- **文件位置**: `src/modules/changes/components/GitOperations.tsx`
- **功能特性**:
  - 提供友好的 UI 界面进行 Git 操作
  - 支持所有基本 Git 写操作
  - 实时错误提示和成功反馈
  - 仅在本地可用项目中启用

**集成示例**:
```typescript
import { GitOperations } from './components/GitOperations';

function MyComponent() {
  return (
    <GitOperations
      project={currentProject}
      service={changesService}
      onOperationComplete={() => {
        // 刷新项目状态
        refreshProjectState();
      }}
    />
  );
}
```

## 技术架构

### 后端层（Rust）
```
src-tauri/src/modules/project.rs
├── Git 写操作核心函数
│   ├── git_commit()       - 提交更改
│   ├── git_checkout()     - 切换分支
│   ├── git_merge()        - 合并分支
│   ├── git_reset()        - 重置状态
│   ├── git_worktree_list() - 列出 worktree
│   ├── git_worktree_create() - 创建 worktree
│   └── git_worktree_remove() - 删除 worktree
│
└── Tauri 命令封装
    ├── #[tauri::command] git_commit()
    ├── #[tauri::command] git_checkout()
    ├── #[tauri::command] git_merge()
    ├── #[tauri::command] git_reset()
    ├── #[tauri::command] git_worktree_list()
    ├── #[tauri::command] git_worktree_create()
    └── #[tauri::command] git_worktree_remove()
```

### 前端层（TypeScript/React）
```
src/modules/changes/
├── contracts/changes.ts          - 类型定义
│   ├── GitCommitRequest
│   ├── GitCommitResult
│   ├── GitCheckoutRequest
│   ├── GitMergeRequest
│   ├── GitMergeResult
│   ├── GitResetRequest
│   ├── GitWorktreeCreateRequest
│   └── GitWorktreeInfo
│
├── services/changesService.ts    - 服务层
│   ├── ChangesNativeAdapter      - 原生调用接口
│   ├── TauriChangesNativeAdapter - Tauri 实现
│   └── ChangesService            - 业务服务
│
└── components/
    ├── GitOperations.tsx         - Git 操作 UI 组件
    └── ChangesReview.tsx         - 代码评审组件（已有）
```

## 代码质量保证

### 类型安全
- ✅ 所有接口都有完整的 TypeScript 类型定义
- ✅ Rust 代码使用强类型系统
- ✅ 前后端类型通过 serde 序列化保持一致

### 错误处理
- ✅ 所有 Git 操作都有适当的错误处理
- ✅ 错误信息清晰，包含错误代码和描述
- ✅ 前端显示用户友好的错误提示

### 测试覆盖
- ✅ 单元测试：`src/modules/changes/services/changesService.test.ts`
- ✅ 所有新增功能都有测试覆盖
- ✅ 测试包括正常流程和错误情况

### 安全性
- ✅ 路径验证：防止路径遍历攻击
- ✅ 权限检查：仅对本地可用项目执行操作
- ✅ 输入验证：验证所有用户输入

## 集成指南

### 在评审流程中集成提交功能

可以在代码评审通过后自动提交更改：

```typescript
// 在 ChangesReview 组件中
async function acceptAllAndCommit() {
  // 1. 接受所有更改
  await acceptAll();
  
  // 2. 自动提交到仓库
  if (project && service) {
    try {
      const result = await service.commit(project, {
        message: `Code review approved - Session ${sessionId}`,
      });
      setNotice(`Changes committed: ${result.commitId}`);
    } catch (error) {
      setError(`Commit failed: ${error.message}`);
    }
  }
}
```

### 使用 Worktree 进行隔离开发

```typescript
// 创建独立的 worktree 用于功能开发
async function createFeatureWorktree(featureName: string) {
  const worktree = await service.worktreeCreate(project, {
    name: `feature-${featureName}`,
    branchName: `feature/${featureName}`,
  });
  
  console.log(`Created worktree at: ${worktree.path}`);
  // 可以在新的 worktree 中进行开发，不影响主工作目录
}
```

## 命令注册

所有新命令已在 `src-tauri/src/lib.rs` 中注册：

```rust
.invoke_handler(tauri::generate_handler![
    // ... 现有命令
    modules::project::git_commit,
    modules::project::git_checkout,
    modules::project::git_merge,
    modules::project::git_reset,
    modules::project::git_worktree_list,
    modules::project::git_worktree_create,
    modules::project::git_worktree_remove
])
```

## 依赖项

### Rust 依赖
- `git2 = "0.20"` - Git 操作库（已在 Cargo.toml 中）
- `serde` - 序列化/反序列化（已有）

### TypeScript 依赖
- `@tauri-apps/api` - Tauri API 调用（已有）
- `react`, `lucide-react` - UI 组件（已有）

## 未来改进建议

1. **高级 Worktree 功能**
   - Worktree 状态监控
   - 自动清理未使用的 worktree
   - Worktree 之间的切换 UI

2. **增强的合并功能**
   - 交互式冲突解决 UI
   - 三方合并工具集成
   - 合并策略选择

3. **提交增强**
   - 提交模板支持
   - GPG 签名支持
   - Commit hook 集成

4. **历史浏览**
   - 提交历史查看
   - 分支可视化
   - 文件历史追踪

## 总结

本实现完整地在现有代码结构基础上添加了 Git 写操作功能，包括：

✅ **Commit** - 提交更改到仓库  
✅ **Checkout** - 切换和创建分支  
✅ **Merge** - 合并分支（含冲突检测）  
✅ **Reset** - 重置工作目录状态  
✅ **Worktree 管理** - 创建、列出、删除 worktree  
✅ **真实评审操作写回仓库** - 通过 GitOperations 组件实现  
✅ **类型安全** - 完整的 TypeScript 和 Rust 类型定义  
✅ **测试覆盖** - 所有新功能都有单元测试  
✅ **错误处理** - 完善的错误处理和用户反馈  

所有功能都保持了与现有代码结构的一致性，没有破坏性更改。
