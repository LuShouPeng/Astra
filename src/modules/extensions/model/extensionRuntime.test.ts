import { describe, expect, it } from 'vitest';
import { fromRuntimeMcp, type RuntimeMcpConfig } from './extensionRuntime';

const runtimeServer: RuntimeMcpConfig = {
  id: 'repo-tools',
  name: 'Repository tools',
  transport: 'streamable_http',
  args: [],
  url: 'https://mcp.example.test',
  enabled: true,
};

describe('fromRuntimeMcp', () => {
  it('keeps secret references empty when the runtime server has no credential reference', () => {
    expect(fromRuntimeMcp(runtimeServer).secretRefs).toEqual({});
  });

  it('uses the default authorization header when a credential reference has no header', () => {
    expect(
      fromRuntimeMcp({ ...runtimeServer, secretRef: 'windows:astra/repository-tools' }).secretRefs,
    ).toEqual({ authorization: 'windows:astra/repository-tools' });
  });

  it('preserves a custom credential header from the runtime server', () => {
    expect(
      fromRuntimeMcp({
        ...runtimeServer,
        secretRef: 'windows:astra/exa',
        secretHeader: 'x-api-key',
      }).secretRefs,
    ).toEqual({ 'x-api-key': 'windows:astra/exa' });
  });
});
