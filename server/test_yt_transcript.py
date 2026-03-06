import sys
import os
import json
import re
from youtube_transcript_api import YouTubeTranscriptApi
from dotenv import load_dotenv

def get_video_id(url):
    """提取 YouTube 视频 ID"""
    patterns = [
        r'(?:v=|\/)([0-9A-Za-z_-]{11}).*',
        r'youtu\.be\/([0-9A-Za-z_-]{11})',
        r'embed\/([0-9A-Za-z_-]{11})',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return url if len(url) == 11 else None

def main():
    if len(sys.argv) < 2:
        print("用法: python3 test_yt_transcript.py <youtube_url>")
        sys.exit(1)

    url = sys.argv[1]
    video_id = get_video_id(url)

    if not video_id:
        print(f"错误: 无法从 '{url}' 中解析出 Video ID")
        sys.exit(1)

    print(f"正在尝试获取视频 '{video_id}' 的字幕...")

    # 加载 .env 里的 Cookies (如果有)
    load_dotenv()
    cookies_content = os.getenv('YOUTUBE_COOKIES')
    cookie_file = "/tmp/yt_cookies.txt"

    try:
        if cookies_content:
            # 还原可能被转义的换行符
            formatted_cookies = cookies_content.replace('\\n', '\n')
            with open(cookie_file, 'w') as f:
                f.write(formatted_cookies)
            print("已加载 YOUTUBE_COOKIES 进行身份验证。")

        # 尝试获取字幕
        # 我们按照优先级尝试中文和英文
        try:
            transcript = YouTubeTranscriptApi.get_transcript(
                video_id,
                languages=['zh-Hans', 'zh-CN', 'zh', 'en'],
                cookies=cookie_file if cookies_content else None
            )

            # 保存为 JSON
            output_file = f"transcript_{video_id}.json"
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(transcript, f, ensure_ascii=False, indent=2)

            print(f"✅ 成功! 字幕已下载至: {output_file}")
            print(f"共获取到 {len(transcript)} 条字幕片段。")

        except Exception as e:
            print(f"❌ 获取失败: {str(e)}")

            # 如果是因为某种特定错误，尝试列出所有可用字幕
            try:
                list_subs = YouTubeTranscriptApi.list_transcripts(video_id, cookies=cookie_file if cookies_content else None)
                print("\n该视频可用的字幕语言:")
                for trans in list_subs:
                    print(f"- {trans.language} ({trans.language_code}) {'[自动生成]' if trans.is_generated else '[人工提供]'}")
            except:
                pass

    finally:
        # 清理临时 Cookie 文件
        if os.path.exists(cookie_file):
            os.remove(cookie_file)

if __name__ == "__main__":
    main()
