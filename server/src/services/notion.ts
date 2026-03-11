import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

export interface NotionPageData {
  title: string;
  url: string;
  takeaways: {
    title: string;
    summary: string;
    timestamp: number;
    duration?: string;
  }[];
  mindmap?: string | null;
}

export async function exportToNotion(data: NotionPageData) {
  const apiKey = process.env.NOTION_API_KEY;
  let databaseId = process.env.NOTION_DATABASE_ID; // Initialize databaseId here
  console.log('NotionPageData====', data)
  if (!apiKey) {
    throw new Error('未配置 NOTION_API_KEY');
  }

  if (!databaseId) {
    throw new Error('未配置 NOTION_DATABASE_ID');
  }

  // 1. 深度提取 ID：处理 URL（含参数）、带横线的 UUID 或 32 位 hex
  // 匹配逻辑：找寻 32 位 hex，忽略 URL 中的其他部分（如 ?v=xxx）
  const cleanIdMatch = databaseId.replace(/-/g, '').match(/([a-f0-9]{32})/i);
  if (!cleanIdMatch) {
    throw new Error(`无法从配置中识别出有效的 Notion 数据库 ID。请检查 .env 中的 NOTION_DATABASE_ID 是否正确。`);
  }
  const cleanId = cleanIdMatch[1];
  // 转换为标准的带横线的 UUID 格式，这是 API 路径中最稳妥的格式
  const formattedId = `${cleanId.slice(0, 8)}-${cleanId.slice(8, 12)}-${cleanId.slice(12, 16)}-${cleanId.slice(16, 20)}-${cleanId.slice(20)}`;

  const notion = new Client({ auth: apiKey });

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const convertMarkdownToMermaid = (md: string) => {
    const lines = md.split('\n');
    const connections: string[] = [];
    const lastNodesByLevel: string[] = [];

    lines.forEach((line, index) => {
      const match = line.match(/^(#+)\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const rawText = match[2].trim().replace(/[()\[\]{}]/g, '').replace(/"/g, "'");
        const nodeId = `n${index}`;

        // 根据层级应用样式类
        let styleClass = '';
        if (level === 1) styleClass = ':::root';
        else if (level === 2) styleClass = ':::branch';
        else styleClass = ':::leaf';

        // 根据层级给节点加上不同的形状
        let nodeDef = '';
        if (level === 1) {
          nodeDef = `${nodeId}(("${rawText}"))${styleClass}`;
        } else if (level === 2) {
          nodeDef = `${nodeId}("${rawText}")${styleClass}`;
        } else {
          nodeDef = `${nodeId}["${rawText}"]${styleClass}`;
        }

        if (level > 1) {
          const parentId = lastNodesByLevel[level - 2];
          if (parentId) {
            connections.push(`${parentId} --> ${nodeDef}`);
          } else {
            connections.push(nodeDef);
          }
        } else {
          connections.push(nodeDef);
        }
        lastNodesByLevel[level - 1] = nodeId;
      }
    });

    const styleDefs = [
      '  classDef root fill:#6366f1,stroke:#4338ca,stroke-width:2px,color:#fff,font-weight:bold',
      '  classDef branch fill:#e0e7ff,stroke:#6366f1,stroke-width:1.5px,color:#1e1b4b',
      '  classDef leaf fill:#f8fafc,stroke:#cbd5e1,stroke-width:1px,color:#334155'
    ].join('\n');

    return `graph LR\n${styleDefs}\n${connections.join('\n')}`;
  };

  try {
    const mermaidContent = data.mindmap ? convertMarkdownToMermaid(data.mindmap) : null;

    let existingPage = null;
    try {
      // 说明：请务必在 Notion UI 的数据库页面右上角 ... -> Connect to 中添加您的集成。
      // 使用底层 request 模式直接查询数据库，避开 SDK 结构不完整的问题。
      console.log(`[Notion] Querying database: ${formattedId}...`);

      const queryBody = {
        filter: {
          property: 'URL',
          url: {
            equals: data.url,
          },
        },
      };

      let result: any;
      if (typeof (notion.databases as any).query === 'function') {
        result = await (notion.databases as any).query({
          database_id: formattedId,
          ...queryBody
        });
      } else {
        // 后备路径：必须包含 v1/ 前缀或者遵循 SDK request 的内部规范
        // 对于 @notionhq/client, .request({ path: 'databases/ID/query' }) 通常是正确的
        result = await (notion as any).request({
          path: `databases/${formattedId}/query`,
          method: 'POST',
          body: queryBody
        });
      }

      existingPage = result.results[0];
    } catch (err) {
      console.warn('[Notion Query Error] 查询失败，可能由于路径错误或未在 Notion 页面中添加 Connections 权限', err);
    }
    const properties: any = {
      'Name': {
        title: [
          {
            text: {
              content: data.title,
            },
          },
        ],
      },
      'URL': {
        url: data.url,
      },
      'Platform': {
        select: {
          name: data.url.includes('bilibili.com') ? 'Bilibili' : 'YouTube',
        },
      },
      'Date': {
        date: {
          start: new Date().toISOString().split('T')[0],
        },
      },
    };

    const childrenBlocks = [
      {
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: '🤖 AI 核心摘要' } }],
        },
      },
      ...data.takeaways.flatMap((t, i) => [
        {
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: `${i + 1}. [${formatTime(t.timestamp)}] ${t.title}`,
                  link: { url: `${data.url}&t=${t.timestamp}` }
                }
              }
            ],
          },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: t.summary || '' } }],
          },
        },
      ]),
      ...(mermaidContent ? [
        {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: '🧠 知识脑图 (Mermaid)' } }],
          },
        },
        {
          object: 'block',
          type: 'code',
          code: {
            language: 'mermaid',
            rich_text: [{ type: 'text', text: { content: mermaidContent } }],
          },
        }
      ] : []),
      {
        object: 'block',
        type: 'divider',
        divider: {},
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: 'Generated by ' },
            },
            {
              type: 'text',
              text: { content: 'AI Video Highlights', link: { url: 'https://github.com/brucekong/ai-video-highlights' } },
              annotations: { italic: true, color: 'blue' }
            }
          ],
        },
      },
    ] as any;

    if (existingPage) {
      console.log(`[Notion] Found existing page: ${existingPage.id}, updating...`);
      // A. 更新页面属性
      await (notion.pages as any).update({
        page_id: existingPage.id,
        properties: properties,
      });

      // B. 刷新内容：删除旧 Block 并追加新 Block
      const existingBlocks = await notion.blocks.children.list({ block_id: existingPage.id });
      for (const block of existingBlocks.results) {
        await notion.blocks.delete({ block_id: block.id });
      }

      // C. 追加新内容
      await notion.blocks.children.append({
        block_id: existingPage.id,
        children: childrenBlocks,
      });

      return existingPage;
    } else {
      // 2. 如果不存在，则创建新页面
      // 重要：必须使用 formattedId 确保是一个合法的 UUID，而不是原始 URL
      const response = await notion.pages.create({
        parent: {
          database_id: formattedId,
        },
        properties: properties,
        children: childrenBlocks,
      });
      return response;
    }
  } catch (error: any) {
    console.error('Notion Export Error:', error);
    throw error;
  }
}
