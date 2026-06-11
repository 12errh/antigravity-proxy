# Plan: Improve Antigravity Proxy for Universal External LLM Support

## Context
The Antigravity Proxy currently supports a curated set of major LLM providers (OpenAI, Anthropic, Google, NVIDIA, OpenRouter, Groq, Zen, Ollama, vLLM, LM Studio) but lacks the extensibility needed to support "any external LLM" perfectly. The architecture has several gaps that prevent universal compatibility:

1. **Adapter Architecture Limitation**: Requires creating new adapter classes for each provider type
2. **Hardcoded Provider Lists**: Provider IDs are hardcoded in multiple files
3. **Limited Model Discovery**: Only 3 local providers supported
4. **No Universal Tool Translation**: Tools must be manually adapted per provider
5. **Limited Provider-Specific Optimizations**: All OpenAI-compatible providers use the same adapter

## Current State Analysis

### What Works Well:
- **Core Translation**: Excellent Google Gemini → provider format translation
- **Tool Support**: Three adapters with comprehensive tool handling
- **Error Handling**: Robust retry and fallback mechanisms
- **Configuration**: Environment-based configuration with web dashboard
- **Performance**: HTTP pooling, rate limiting, cost tracking
- **Documentation**: Comprehensive agent-context.md and dashboard UI

### Critical Gaps:
1. **Adapter Architecture**: Provider-specific optimizations missing
2. **Provider Discovery**: Limited to 3 local solutions
3. **Tool Translation**: No universal tool normalization
4. **Extensibility**: Hardcoded provider lists prevent easy addition
5. **Model Resolution**: Limited provider-specific mappings

## Recommended Approach

### Phase 1: Plugin Architecture (High Impact, Medium Complexity)

**Goal**: Create a plugin system for providers that allows dynamic registration and adapter factory pattern.

**Implementation**:
1. **Provider Plugin Interface**: Define `IProviderPlugin` interface with methods:
   - `getAdapter()`: Returns appropriate adapter instance
   - `getCapabilities()`: Returns provider capabilities
   - `validateConfig()`: Validates provider configuration

2. **Adapter Factory**: Create `ProviderAdapterFactory` that:
   - Dynamically loads provider plugins
   - Instantiates appropriate adapters based on provider type
   - Supports both built-in and external plugins

3. **Provider Registry**: Create `ProviderRegistry` that:
   - Manages registered providers
   - Handles provider discovery and registration
   - Provides provider metadata and capabilities

**Files to Modify**:
- `proxy/src/adapter.ts`: Refactor to use plugin architecture
- `proxy/src/config.ts`: Add plugin discovery and registration
- `proxy/src/engine.ts`: Update to use factory pattern
- `proxy/src/router.ts`: Integrate with provider registry

### Phase 2: Universal Tool Translation (High Impact, High Complexity)

**Goal**: Implement a universal tool translation layer that normalizes tool schemas across providers.

**Implementation**:
1. **Tool Schema Normalizer**: Create `ToolNormalizer` class that:
   - Converts provider-specific tool schemas to universal format
   - Maintains tool metadata and descriptions
   - Handles parameter type conversions

2. **Tool Execution Router**: Create `ToolExecutionRouter` that:
   - Routes tool calls to appropriate provider-specific adapters
   - Handles provider-specific tool execution requirements
   - Manages tool call batching and optimization

3. **Tool Capability Registry**: Create `ToolCapabilityRegistry` that:
   - Tracks tool support per provider
   - Provides tool compatibility information
   - Enables intelligent tool selection

**Files to Modify**:
- `proxy/src/adapter.ts`: Add tool normalization layer
- `proxy/src/engine.ts`: Integrate tool execution router
- `proxy/src/router.ts`: Add tool capability awareness
- New file: `proxy/src/tool-normalizer.ts`

### Phase 3: Enhanced Model Discovery (Medium Impact, Low Complexity)

**Goal**: Expand local provider discovery to support more inference solutions.

**Implementation**:
1. **Universal Provider Discovery**: Create `UniversalProviderDiscovery` that:
   - Detects common inference endpoints
   - Supports multiple inference solutions (llama.cpp, text-generation-webui, etc.)
   - Auto-detects provider capabilities and model availability

2. **Model Capability Detection**: Create `ModelCapabilityDetector` that:
   - Discovers available models per provider
   - Detects model capabilities (reasoning, tools, streaming)
   - Caches model metadata for performance

**Files to Modify**:
- `proxy/src/local-discovery.ts`: Expand discovery capabilities
- `proxy/src/models.ts`: Add model capability detection
- New file: `proxy/src/universal-discovery.ts`

### Phase 4: Provider-Specific Optimizations (Medium Impact, Medium Complexity)

**Goal**: Create provider-specific adapters for OpenAI-compatible providers.

**Implementation**:
1. **Provider-Specific Adapters**: Create adapters for:
   - `GroqAdapter`: Optimized for Groq-specific features
   - `ZenAdapter`: Optimized for Zen/OpenCode-specific features
   - `NvidiaAdapter`: Optimized for NVIDIA-specific features

2. **Feature Detection**: Add feature detection to:
   - Reasoning effort support
   - Tool capabilities
   - Streaming optimizations
   - Rate limiting strategies

**Files to Modify**:
- `proxy/src/adapters/groq.ts`: New file
- `proxy/src/adapters/zen.ts`: New file
- `proxy/src/adapters/nvidia.ts`: New file
- `proxy/src/adapter.ts`: Update to use provider-specific adapters

## Verification

### Testing Strategy:
1. **Unit Tests**: Test each new component in isolation
2. **Integration Tests**: Test plugin architecture with existing providers
3. **End-to-End Tests**: Test universal tool translation with multiple providers
4. **Performance Tests**: Verify no performance regression
5. **Compatibility Tests**: Test with various external LLM providers

### Test Files to Create:
- `proxy/test/plugin-architecture.test.ts`
- `proxy/test/tool-normalizer.test.ts`
- `proxy/test/universal-discovery.test.ts`
- `proxy/test/provider-specific-adapters.test.ts`

### Manual Testing:
1. **Add new provider**: Test adding a completely new provider (e.g., Cohere, Perplexity)
2. **Tool compatibility**: Test tool calls with different providers
3. **Model discovery**: Test auto-discovery of local providers
4. **Configuration**: Test dynamic provider configuration

## Expected Outcomes

### After Phase 1 (Plugin Architecture):
- Easy addition of new providers without code changes
- Dynamic provider registration and discovery
- Support for external provider plugins
- Reduced maintenance overhead

### After Phase 2 (Universal Tool Translation):
- Consistent tool behavior across all providers
- Reduced tool configuration complexity
- Better tool compatibility and error handling
- Easier tool debugging and troubleshooting

### After Phase 3 (Enhanced Model Discovery):
- Support for more inference solutions
- Better model capability detection
- Improved provider auto-discovery
- Enhanced user experience

### After Phase 4 (Provider-Specific Optimizations):
- Better performance for major providers
- Provider-specific feature support
- Improved error handling and reliability
- Enhanced user experience

## Risk Mitigation

### Technical Risks:
1. **Plugin Architecture Complexity**: Start with simple plugin interface, iterate based on feedback
2. **Tool Translation Complexity**: Implement incremental tool normalization
3. **Performance Impact**: Add performance monitoring and optimization
4. **Backward Compatibility**: Maintain existing API while adding new features

### Project Risks:
1. **Development Timeline**: Break into smaller, manageable phases
2. **Testing Coverage**: Prioritize critical paths and edge cases
3. **Documentation**: Update documentation incrementally
4. **User Training**: Provide clear documentation and examples

## Timeline

### Phase 1 (Weeks 1-2):
- Implement plugin architecture
- Update existing providers to use new architecture
- Add basic provider registry

### Phase 2 (Weeks 3-4):
- Implement universal tool translation
- Update existing tool handling
- Add tool capability registry

### Phase 3 (Weeks 5-6):
- Implement enhanced model discovery
- Expand local provider support
- Add model capability detection

### Phase 4 (Weeks 7-8):
- Implement provider-specific adapters
- Add feature detection
- Optimize performance

### Testing & Documentation (Weeks 9-10):
- Comprehensive testing
- Documentation updates
- User training materials

## Success Metrics

### Technical Metrics:
- **Provider Addition Time**: < 1 hour to add new provider
- **Tool Compatibility**: 95%+ tool compatibility across providers
- **Performance Impact**: < 5% performance degradation
- **Test Coverage**: > 90% test coverage for new components

### User Experience Metrics:
- **Configuration Simplicity**: < 5 minutes to configure new provider
- **Tool Usage**: Consistent tool experience across providers
- **Error Handling**: Clear, actionable error messages
- **Documentation**: Comprehensive provider documentation

This plan will transform the Antigravity Proxy from a curated provider solution to a truly universal external LLM proxy that can support "any external LLM" while maintaining backward compatibility and improving the user experience.
