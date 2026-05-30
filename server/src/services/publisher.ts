import { getBridgeClient, type BridgeClient } from './bridge.js';
import { getTemplate, resolveTemplate, type PublishContext, type PublishStep } from '../templates/index.js';
import { getWxvideoSteps } from '../templates/wxvideo.js';

export interface PublishTaskInput {
  taskId: string;
  platform: string;
  context: PublishContext;
}

export interface StepResult {
  step: number;
  action: string;
  success: boolean;
  screenshot?: string; // base64
  error?: string;
}

export interface PublishResult {
  taskId: string;
  success: boolean;
  steps: StepResult[];
  error?: string;
}

export type ProgressCallback = (taskId: string, step: number, total: number, action: string) => void;

export class Publisher {
  private bridge: BridgeClient;
  private onProgress?: ProgressCallback;

  constructor(bridge?: BridgeClient, onProgress?: ProgressCallback) {
    this.bridge = bridge ?? getBridgeClient();
    this.onProgress = onProgress;
  }

  async execute(input: PublishTaskInput): Promise<PublishResult> {
    const template = getTemplate(input.platform);
    if (!template) {
      return { taskId: input.taskId, success: false, steps: [], error: `No template for platform: ${input.platform}` };
    }

    // Use dynamic steps based on publishMode for wxvideo
    const steps = input.platform === 'wxvideo'
      ? getWxvideoSteps(input.context.publishMode ?? 'draft')
      : template.steps;

    // Ensure bridge is connected
    if (this.bridge.status !== 'connected') {
      try {
        console.log(`[Publisher] Connecting to bridge...`);
        await this.bridge.connect();
        console.log(`[Publisher] Bridge connected`);
      } catch (err) {
        console.error(`[Publisher] Bridge connection failed:`, (err as Error).message);
        return { taskId: input.taskId, success: false, steps: [], error: `Bridge connection failed: ${(err as Error).message}` };
      }
    }

    const stepResults: StepResult[] = [];
    let currentPageId: string | undefined;

    console.log(`[Publisher] Executing ${steps.length} steps for ${input.platform}`);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      console.log(`[Publisher] Step ${i + 1}/${steps.length}: ${step.action}`);
      this.onProgress?.(input.taskId, i + 1, steps.length, step.action);

      try {
        const result = await this.executeStep(step, input.context, currentPageId);
        if (result.pageId) currentPageId = result.pageId;

        stepResults.push({
          step: i + 1,
          action: step.action,
          success: true,
          screenshot: result.screenshot,
        });
      } catch (err) {
        // Cover upload is always optional — skip on failure
        if (step.action === 'upload' && (step.fileField === 'cover43' || step.fileField === 'cover34')) {
          console.log(`[Publisher] Cover upload skipped: ${(err as Error).message}`);
          stepResults.push({ step: i + 1, action: step.action, success: true });
          continue;
        }

        stepResults.push({
          step: i + 1,
          action: step.action,
          success: false,
          error: (err as Error).message,
        });

        return { taskId: input.taskId, success: false, steps: stepResults, error: `Step ${i + 1} (${step.action}) failed: ${(err as Error).message}` };
      }
    }

    return { taskId: input.taskId, success: true, steps: stepResults };
  }

  private async executeStep(
    step: PublishStep,
    ctx: PublishContext,
    pageId?: string,
  ): Promise<{ pageId?: string; screenshot?: string }> {
    switch (step.action) {
      case 'openPage': {
        const result = await this.bridge.openPage(step.url, step.reuse);
        return { pageId: result.pageId };
      }
      case 'waitForSelector': {
        if (!pageId) throw new Error('No active page');
        await this.bridge.waitForSelector(pageId, step.selector, step.timeoutMs);
        return {};
      }
      case 'click': {
        if (!pageId) throw new Error('No active page');
        await this.bridge.click(pageId, step.selector, step.timeoutMs);
        return {};
      }
      case 'clickText': {
        if (!pageId) throw new Error('No active page');
        await this.bridge.clickText(pageId, step.container, step.text, step.timeoutMs);
        return {};
      }
      case 'fill': {
        if (!pageId) throw new Error('No active page');
        let text = resolveTemplate(step.value, ctx);
        // Apply platform-specific text cleaning
        if (ctx._platformCleaner) text = ctx._platformCleaner(text, step.selector);
        await this.bridge.fill(pageId, step.selector, text, step.timeoutMs);
        return {};
      }
      case 'upload': {
        if (!pageId) throw new Error('No active page');
        let filePath: string | undefined;
        if (step.fileField === 'video') filePath = ctx.videoFilePath;
        else if (step.fileField === 'cover43') filePath = ctx.cover43FilePath;
        else if (step.fileField === 'cover34') filePath = ctx.cover34FilePath;
        if (!filePath) throw new Error(`No file path for ${step.fileField}`);
        await this.bridge.upload(pageId, step.selector, [filePath], step.timeoutMs);
        return {};
      }
      case 'checkError': {
        if (!pageId) throw new Error('No active page');
        // Check if an error message element exists on page
        try {
          const errorText = await this.bridge.getText(pageId, step.selector);
          if (errorText && errorText.trim()) {
            throw new Error(`Validation error: ${errorText.trim()}`);
          }
        } catch (err) {
          // If getText fails (element not found), no error — that's good
          if ((err as Error).message.startsWith('Validation error:')) throw err;
        }
        return {};
      }
      case 'delay': {
        await new Promise((resolve) => setTimeout(resolve, step.ms));
        return {};
      }
      case 'screenshot': {
        if (!pageId) throw new Error('No active page');
        const data = await this.bridge.screenshot(pageId);
        return { screenshot: data };
      }
      default:
        throw new Error(`Unknown action: ${(step as PublishStep).action}`);
    }
  }
}
