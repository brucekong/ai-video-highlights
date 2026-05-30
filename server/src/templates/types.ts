/**
 * Publish template types.
 * A template is a declarative sequence of browser actions for publishing to a platform.
 */

export interface PublishContext {
  title: string;
  description?: string;
  hashtags?: string;
  videoFilePath: string;
  cover43FilePath?: string;  // 4:3 cover
  cover34FilePath?: string;  // 3:4 cover
  /** Platform-specific overrides */
  platformTitle?: string;
  platformDesc?: string;
  /** draft = save as draft, publish = publish immediately */
  publishMode?: 'draft' | 'publish';
  /** Internal: platform-specific text cleaner applied during fill */
  _platformCleaner?: (text: string, selector: string) => string;
}

export type PublishStep =
  | { action: 'openPage'; url: string; reuse?: { urlIncludes: string } }
  | { action: 'waitForSelector'; selector: string; timeoutMs?: number }
  | { action: 'click'; selector: string; timeoutMs?: number }
  | { action: 'clickText'; container: string; text: string; timeoutMs?: number }
  | { action: 'fill'; selector: string; value: string; timeoutMs?: number }
  | { action: 'upload'; selector: string; fileField: 'video' | 'cover43' | 'cover34'; timeoutMs?: number }
  | { action: 'delay'; ms: number }
  | { action: 'screenshot'; label: string }
  | { action: 'checkError'; selector: string; timeoutMs?: number };

/**
 * Template value strings support placeholders: {{title}}, {{description}}, {{hashtags}}
 * These are resolved at runtime from PublishContext.
 */
export function resolveTemplate(value: string, ctx: PublishContext): string {
  return value
    .replace(/\{\{title\}\}/g, ctx.platformTitle ?? ctx.title)
    .replace(/\{\{description\}\}/g, ctx.platformDesc ?? ctx.description ?? ctx.title)
    .replace(/\{\{hashtags\}\}/g, ctx.hashtags ? ctx.hashtags.split(',').map(t => `#${t.trim()}`).join(' ') : '');
}

export interface PublishTemplate {
  platform: string;
  displayName: string;
  steps: PublishStep[];
}
