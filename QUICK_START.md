# Git 写操作快速开始指南

## 🚀 快速开始

本指南帮助你快速开始使用 Astra Nexus Workbench 中新增的 Git 写操作功能。

---

## 前提条件

1. ✅ 项目必须是**本地 Git 仓库**
2. ✅ Git 已正确配置（user.name 和 user.email）
3. ✅ 项目处于**可用状态**（非 Demo 项目）

---

## 使用方式

### 方式一：通过 UI 组件（推荐）

在你的页面中集成 `GitOperations` 组件：

```typescript
import { GitOperations } from './modules/changes/components/GitOperations';

function MyChangesPage() {
  const { project, changesService } = useYourContext();

  return (
    <div>
      {/* 你的其他内容 */}
      
      <GitOperations
        project={project}
        service={changesService}
        onOperationComplete={() => {
          // 操作完成后的回调，例如刷新变更列表
          refreshChanges();
        }}
      />
    </div>
  );
}
```

组件提供了友好的 UI 界面，支持：
- 📝 Commit - 提交更改
- 🌿 Checkout - 切换/创建分支
- 🔀 Merge - 合并分支
- ⏪ Reset - 重置状态

### 方式二：通过服务 API

直接调用 `ChangesService` 的方法：

#### 1️⃣ 提交更改

```typescript
// 提交所有更改
const result = await changesService.commit(project, {
  message: "完成用户认证功能"
});

console.log(`提交成功: ${result.commitId} -> ${result.branch}`);
```

```typescript
// 只提交特定文件
const result = await changesService.commit(project, {
  message: "修复登录 bug",
  filePaths: ["src/auth/login.ts", "src/auth/session.ts"]
});
```

```typescript
// 使用自定义作者信息
const result = await changesService.commit(project, {
  message: "添加新特性",
  authorName: "张三",
  authorEmail: "zhangsan@example.com"
});
```

#### 2️⃣ 切换分支

```typescript
// 切换到现有分支
await changesService.checkout(project, {
  branchName: "develop",
  createNew: false
});
```

```typescript
// 创建新分支并切换
await changesService.checkout(project, {
  branchName: "feature/new-dashboard",
  createNew: true
});
```

#### 3️⃣ 合并分支

```typescript
const result = await changesService.merge(project, {
  branchName: "feature/user-profile"
});

if (result.success) {
  console.log("合并成功！");
} else {
  console.log("合并冲突，请手动解决:");
  result.conflicts.forEach(file => {
    console.log(`  - ${file}`);
  });
}
```

#### 4️⃣ 重置状态

```typescript
// Soft reset - 保留所有更改（已暂存）
await changesService.reset(project, {
  resetType: "soft"
});
```

```typescript
// Mixed reset - 保留工作目录更改，清空暂存区（默认）
await changesService.reset(project, {
  resetType: "mixed"
});
```

```typescript
// Hard reset - 丢弃所有更改 ⚠️
await changesService.reset(project, {
  resetType: "hard"
});
```

```typescript
// 重置到特定提交
await changesService.reset(project, {
  commitId: "abc123def456",
  resetType: "hard"
});
```

#### 5️⃣ Worktree 管理

```typescript
// 列出所有 worktree
const worktrees = await changesService.worktreeList(project);
worktrees.forEach(wt => {
  console.log(`${wt.name}: ${wt.path} (${wt.branch})`);
});
```

```typescript
// 创建新 worktree
const worktree = await changesService.worktreeCreate(project, {
  name: "hotfix-workspace",
  branchName: "hotfix/critical-bug"
});

console.log(`Worktree 创建在: ${worktree.path}`);
```

```typescript
// 删除 worktree
await changesService.worktreeRemove(project, "hotfix-workspace");
```

---

## 常见使用场景

### 场景 1: 代码评审后提交

```typescript
// 在评审通过所有更改后
async function acceptAndCommit() {
  try {
    // 1. 接受评审
    await acceptAllChanges();
    
    // 2. 提交到仓库
    const result = await changesService.commit(project, {
      message: `代码评审通过 - Session ${sessionId}\n\n所有更改已验收并通过测试。`
    });
    
    showSuccess(`更改已提交: ${result.commitId}`);
  } catch (error) {
    showError(`提交失败: ${error.message}`);
  }
}
```

### 场景 2: 功能分支工作流

```typescript
// 开始新功能
async function startNewFeature(featureName: string) {
  // 1. 切换到主分支
  await changesService.checkout(project, {
    branchName: "main",
    createNew: false
  });
  
  // 2. 创建功能分支
  await changesService.checkout(project, {
    branchName: `feature/${featureName}`,
    createNew: true
  });
  
  console.log(`开始开发功能: ${featureName}`);
}

// 完成功能开发
async function finishFeature(featureName: string, commitMessage: string) {
  // 1. 提交更改
  await changesService.commit(project, {
    message: commitMessage
  });
  
  // 2. 切换回主分支
  await changesService.checkout(project, {
    branchName: "main",
    createNew: false
  });
  
  // 3. 合并功能分支
  const result = await changesService.merge(project, {
    branchName: `feature/${featureName}`
  });
  
  if (!result.success) {
    throw new Error(`合并冲突: ${result.conflicts.join(', ')}`);
  }
  
  console.log(`功能 ${featureName} 已合并到主分支`);
}
```

### 场景 3: 使用 Worktree 进行并行开发

```typescript
// 在不影响主工作区的情况下修复紧急 bug
async function createHotfixWorktree() {
  // 创建独立的 worktree 用于 hotfix
  const worktree = await changesService.worktreeCreate(project, {
    name: "hotfix-urgent",
    branchName: "hotfix/security-patch"
  });
  
  console.log(`
    Hotfix worktree 已创建！
    位置: ${worktree.path}
    
    现在你可以:
    1. 在主工作区继续功能开发
    2. 在 ${worktree.path} 中修复 bug
    3. 两个工作区互不干扰
  `);
}

// 完成后清理
async function cleanupHotfixWorktree() {
  // 1. 提交 hotfix 更改（在 worktree 中完成）
  // 2. 合并到主分支
  // 3. 删除 worktree
  await changesService.worktreeRemove(project, "hotfix-urgent");
  
  console.log("Hotfix worktree 已清理");
}
```

### 场景 4: 撤销错误的更改

```typescript
// 撤销未提交的更改
async function discardAllChanges() {
  const confirmed = confirm(
    "⚠️ 这将丢弃所有未提交的更改，确定继续吗？"
  );
  
  if (confirmed) {
    await changesService.reset(project, {
      resetType: "hard"
    });
    
    showSuccess("所有更改已撤销");
  }
}

// 撤销最后一次提交（保留更改）
async function undoLastCommit() {
  await changesService.reset(project, {
    commitId: "HEAD~1", // 回退一个提交
    resetType: "soft"   // 保留更改
  });
  
  showSuccess("最后一次提交已撤销，更改仍保留");
}
```

---

## 错误处理最佳实践

```typescript
async function safeGitOperation() {
  try {
    // 执行 Git 操作
    await changesService.commit(project, {
      message: "我的提交"
    });
    
  } catch (error) {
    if (error instanceof ChangesOperationError) {
      // 处理特定的 Git 操作错误
      if (error.message.includes("GIT_CONFIG_ERROR")) {
        showError("请先配置 Git 用户信息:\n" +
                 "git config user.name \"你的名字\"\n" +
                 "git config user.email \"你的邮箱\"");
      } else {
        showError(`操作失败: ${error.message}`);
      }
    } else {
      // 处理其他错误
      console.error("未知错误:", error);
      showError("操作失败，请查看控制台");
    }
  }
}
```

---

## 注意事项

### ⚠️ Hard Reset 警告
Hard reset 会**永久丢弃**所有未提交的更改，使用前请确认：
```typescript
if (resetType === "hard") {
  const confirmed = confirm(
    "⚠️ Hard reset 将永久丢弃所有未提交的更改！\n" +
    "确定要继续吗？"
  );
  if (!confirmed) return;
}
```

### 📋 合并冲突处理
当合并产生冲突时：
```typescript
const result = await changesService.merge(project, { branchName: "feature" });

if (!result.success) {
  console.log("需要手动解决以下文件的冲突:");
  result.conflicts.forEach(file => console.log(`  - ${file}`));
  
  // 此时你需要:
  // 1. 在编辑器中打开冲突文件
  // 2. 手动解决冲突标记 (<<<<<<<, =======, >>>>>>>)
  // 3. 保存文件
  // 4. 重新提交
}
```

### 🔒 权限要求
- 只有**本地项目**可以执行 Git 写操作
- Demo 项目会抛出错误: "Demo changes are read from the frozen prototype snapshot"
- 确保对项目目录有写权限

---

## 故障排除

### 问题 1: "Git user not configured"

**解决方案**:
```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

### 问题 2: "This project directory is missing"

**解决方案**:
- 检查项目路径是否存在
- 确保项目未被移动或删除
- 重新导入项目

### 问题 3: Merge 冲突

**解决方案**:
1. 查看 `result.conflicts` 数组中列出的文件
2. 手动编辑冲突文件，解决冲突标记
3. 保存文件后重新提交

### 问题 4: Worktree 已存在

**解决方案**:
```typescript
// 先删除现有的 worktree
await changesService.worktreeRemove(project, "existing-name");

// 然后创建新的
await changesService.worktreeCreate(project, {
  name: "existing-name",
  branchName: "my-branch"
});
```

---

## 更多信息

- 📚 完整文档: `GIT_OPERATIONS_IMPLEMENTATION.md`
- 📊 实现总结: `GIT_OPERATIONS_SUMMARY.md`
- ✅ 验证报告: `IMPLEMENTATION_VERIFICATION.md`

---

## 反馈与支持

如果遇到问题或有建议，请：
1. 查看详细文档
2. 检查错误信息
3. 查看控制台日志

祝你使用愉快！🎉
