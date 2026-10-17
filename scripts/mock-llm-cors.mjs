/**
 * mock-llm-cors.mjs — 假模型接口，专门用来测「浏览器直连」这条路
 * 打开 CORS（Access-Control-Allow-Origin: *），所以浏览器可以直接 POST 过来。
 * 监听 127.0.0.1:7399
 *
 * 只会被 scripts 里的自检使用，不参与任何真实功能。
 */
import http from 'node:http';

const reply = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST,OPTIONS',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST,OPTIONS',
    });
    res.end();
    return;
  }

  let raw = '';
  for await (const c of req) raw += c;
  let body = {};
  try { body = JSON.parse(raw); } catch { /* ignore */ }

  // 生图接口：返回一个 1x1 PNG 的 b64，够用来验证链路
  if ((req.url || '').includes('/images/generations')) {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    reply(res, 200, { created: Date.now(), data: [{ b64_json: png, revised_prompt: 'mock' }] });
    return;
  }

  const sys = body.messages?.[0]?.content || '';
  const user = body.messages?.[1]?.content || '';
  let content = 'OK';

  if (sys.includes('分镜导演')) {
    // AI 导演：选第一个候选，并给每格排戏
    try {
      const brief = JSON.parse(user);
      const c = brief['候选模板'][0];
      const panels = (c.slots || []).map((s, i) => ({
        slotId: s.id,
        beat: '测试节拍',
        content: `第 ${s.order ?? i + 1} 格：测试画面内容`,
        dialogue: i === 0 ? '测试台词' : '',
      }));
      content = JSON.stringify({
        pick: c.id,
        confidence: 0.91,
        reason: '自检用：直接选第一套候选',
        alternatives: [],
        panels,
      });
    } catch (e) {
      content = JSON.stringify({ pick: 'bad-id', panels: [] });
    }
  } else if (sys.includes('提示词工程师')) {
    // 提示词优化：给每格一条英文
    try {
      const brief = JSON.parse(user);
      const panels = (brief['格'] || []).map((p) => ({
        slotId: p.slotId,
        prompt: `${p.shapePrefix || 'test framing'} , mock prompt for panel ${p.order}`,
        negative: 'text, watermark',
      }));
      content = JSON.stringify({ globalNotes: '自检用提示', panels });
    } catch {
      content = JSON.stringify({ globalNotes: '', panels: [] });
    }
  } else if (sys.includes('连通性测试')) {
    content = 'OK';
  }

  reply(res, 200, {
    id: 'mock',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
});

server.listen(7399, '127.0.0.1', () => {
  console.log('mock LLM (CORS 开放)  http://127.0.0.1:7399/v1/chat/completions');
});
