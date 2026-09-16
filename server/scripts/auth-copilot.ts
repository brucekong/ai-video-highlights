import { loginGitHubCopilot } from '@earendil-works/pi-ai/oauth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');

// 如果本机有 Clash / Surge / 代理，自动注入代理支持国内访问 GitHub
if (!process.env.https_proxy && !process.env.HTTPS_PROXY) {
  // 探测常见本地代理端口
  process.env.https_proxy = 'http://127.0.0.1:7897';
  process.env.http_proxy = 'http://127.0.0.1:7897';
}

async function main() {
  console.log('\n🚀 正在连接 GitHub 发起 Copilot 授权请求...');

  try {
    const creds = await loginGitHubCopilot({
      onAuth: (url, instructions) => {
        console.log('\n--------------------------------------------------');
        console.log('🔗 1. 请在浏览器打开授权网址：');
        console.log(`   \x1b[36m\x1b[4m${url}\x1b[0m`);
        console.log('\n🔑 2. 输入 8 位设备验证码：');
        console.log(`   \x1b[32m\x1b[1m${instructions}\x1b[0m`);
        console.log('--------------------------------------------------\n');
        console.log('⏳ 正在等待您在网页中确认授权（请勿关闭此终端）...\n');
      },
      onPrompt: async () => ''
    });

    console.log('🎉 GitHub Copilot 授权成功！');

    // 写入或更新 server/.env 中的 COPILOT_GITHUB_TOKEN
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    if (envContent.includes('COPILOT_GITHUB_TOKEN=')) {
      envContent = envContent.replace(/COPILOT_GITHUB_TOKEN=.*/g, `COPILOT_GITHUB_TOKEN=${creds.refresh}`);
    } else {
      envContent += `\nCOPILOT_GITHUB_TOKEN=${creds.refresh}\n`;
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log(`✅ 已成功将 Copilot Token 保存至: ${envPath}`);
    console.log('💡 现在刷新网页，右侧 AI 伴学的【Copilot · GPT-4o】和【Copilot · Claude Sonnet】已就绪可用！\n');
  } catch (error: any) {
    console.error('\n❌ 授权过程出错:', error.message || error);
    console.log('提示：请确认网络能够正常访问 GitHub。如果开启了代理，请确认代理软件正常运行。\n');
    process.exit(1);
  }
}

main();
