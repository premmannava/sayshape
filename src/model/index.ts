/**
 * Connecting SayShape to a model (`sayshape/model`): stream a spec from any
 * OpenAI-compatible endpoint, clean it, check it and repair it once.
 * Also cachedPrompt, a system prompt laid out for prompt caching, for apps that
 * call their model themselves. Nothing here is used by the engine itself; it's
 * for apps and tools.
 */
export { generateSpec, repairPrompt, type Attempt, type GenerateOptions, type GenerateResult, type Phase } from "./generate";
export { refineMessages, nextRefineContext, sumUsage, DEFAULT_MAX_CHANGES, type RefineContext, type ContextPolicy, type ContextInfo, type UsageTotals } from "./context";
export { cachedPrompt, type CachedPrompt, type CachedPromptOptions, type CacheTtl, type TextBlock } from "./cache";
export { streamChat, ModelError, type ChatMessage, type ModelConfig, type StreamPart, type Usage } from "./stream";
export { SpecFilter, sayShapeLineTest, tidySpec, type FilterOutput } from "./clean";
