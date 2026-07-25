import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import type { AgentRuntimeService } from '../../agents';
import { TauriSessionPersistence, type SessionPersistence } from '../adapters/sessionPersistenceAdapter';
import {
  createLiveSessionService,
  type LiveSessionService,
} from '../services/liveSessionService';
import { createWorkbenchLiveSessionSink } from '../services/workbenchLiveSessionSink';

const LiveSessionContext = createContext<LiveSessionService | null>(null);

/**
 * 提供全局单例 LiveSessionService，桥接 WorkbenchContext.updateSnapshot。
 * 必须挂在 WorkbenchProvider 之内（依赖 updateSnapshot）；因流订阅需跨页面存活，
 * 挂在路由之上，避免 SessionDetailPage 卸载时丢订阅。
 */
export function LiveSessionProvider({
  children,
  agentRuntime,
  persistence,
}: {
  children: ReactNode;
  agentRuntime: AgentRuntimeService;
  persistence?: SessionPersistence;
}) {
  const { updateSnapshot } = useWorkbench();

  const service = useMemo(() => {
    const sink = createWorkbenchLiveSessionSink(updateSnapshot);
    return createLiveSessionService({
      agentRuntime,
      persistence: persistence ?? new TauriSessionPersistence(),
      sink,
    });
  }, [agentRuntime, persistence, updateSnapshot]);

  useEffect(() => () => service.dispose(), [service]);

  return <LiveSessionContext.Provider value={service}>{children}</LiveSessionContext.Provider>;
}

/** 读取 live 会话服务；不在 Provider 内返回 null（demo 会话不需要）。 */
export function useLiveSessions(): LiveSessionService | null {
  return useContext(LiveSessionContext);
}
