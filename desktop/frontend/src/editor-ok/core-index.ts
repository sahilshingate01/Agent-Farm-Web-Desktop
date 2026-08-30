/**
 * Local barrel standing in for `@inkeep/open-knowledge-core` — re-exports the
 * vendored core surface the app-side editor files import, plus no-op stubs
 * for upstream's OpenTelemetry metric counters (not vendored).
 */
export { sharedExtensions } from './core/extensions/shared'
export { MarkdownManager } from './core/markdown/index'
export { CodeBlockFidelity } from './core/extensions/code-block-fidelity'
export {
  collectFootnoteIdentifiers,
  findFootnoteDefinitionInsertPos,
  nextFootnoteIdentifier,
} from './core/extensions/footnote-reference'
export { getHeadingSlug, toWikiLinkSlug } from './core/utils/slug'
export { SAFE_URL_SCHEMES } from './core/markdown/safe-url'
export { isAllowedLinkUri } from './core/extensions/link-fidelity'

/** Upstream OTel counter — stubbed to a no-op in the vendored build. */
export function incrementBlockGripClickSelectFailed(_nodeType: string): void {}

/** Upstream OTel counter — stubbed to a no-op in the vendored build. */
export function incrementJsxArrowNodeSelectFailed(_nodeType: string): void {}
