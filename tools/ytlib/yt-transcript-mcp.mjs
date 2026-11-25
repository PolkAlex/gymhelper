// Minimal MCP stdio server: YouTube transcripts via youtube-transcript (maintained lib).
// Local agent tooling (PRO-T3) — lives OUTSIDE the repo in %TEMP%\opencode\mcptools.
// Re-setup after temp cleanup: cd here; npm init -y; npm i youtube-transcript
import { spawn } from 'node:child_process';
import { YoutubeTranscript } from 'youtube-transcript';

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function result(id, payload) { send({ jsonrpc: '2.0', id, result: payload }); }
function toolText(id, text, isError = false) {
  result(id, { content: [{ type: 'text', text }], isError });
}

function extractId(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/(?:v=|\/shorts\/|youtu\.be\/)([\w-]{11})/);
  if (m) return m[1];
  if (/^[\w-]{11}$/.test(s)) return s;
  return null;
}

const TOOLS = [
  {
    name: 'get_transcript',
    description: 'Fetch YouTube video transcript (native captions). Input: url (video URL or 11-char ID), lang (optional, e.g. ru, en — falls back to any available).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'YouTube video URL or video ID' },
        lang: { type: 'string', description: 'Caption language code, e.g. ru, en' },
      },
      required: ['url'],
    },
  },
];

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handleMessage(msg);
  }
});

async function handleMessage(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') {
      result(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'yt-transcript-local', version: '1.0.0' },
      });
    } else if (method === 'tools/list') {
      result(id, { tools: TOOLS });
    } else if (method === 'tools/call') {
      if (params?.name !== 'get_transcript') return toolText(id, `Unknown tool: ${params?.name}`, true);
      const vid = extractId(params.arguments?.url);
      if (!vid) return toolText(id, `Cannot parse YouTube video ID from: ${params.arguments?.url}`, true);
      const lang = params.arguments?.lang;
      let list;
      try {
        list = await YoutubeTranscript.fetchTranscript(vid, lang ? { lang } : undefined);
      } catch (e) {
        // fall back to any available language
        try {
          list = await YoutubeTranscript.fetchTranscript(vid);
        } catch (e2) {
          return toolText(id, `No transcript for ${vid}: ${String(e2.message).slice(0, 300)}`, true);
        }
      }
      const text = (list || []).map((x) => x.text).join(' ').replace(/\s+/g, ' ').trim();
      const out = text
        ? `videoId: ${vid}\nchars: ${text.length}\n\n${text}`
        : `videoId: ${vid}\ntranscript is empty`;
      toolText(id, out);
    } else {
      result(id, {});
    }
  } catch (e) {
    result(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true });
  }
}

// keep alive
setInterval(() => {}, 1 << 30);
process.on('SIGINT', () => process.exit(0));
void spawn;
