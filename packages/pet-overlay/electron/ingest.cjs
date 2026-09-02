// Claude Code transcript(JSONL) 증분 파싱 — 실측 필드 기반
// 기획: 성장시스템.md §1 (ccusage 계열, hook 수신 후 transcript 파싱)
const fs = require('fs');

// 유효 토큰 = 입력 + 출력 (캐시 생성/재읽기는 제외 — 매 턴 반복·과다 계상 방지)
function effectiveTokens(usage) {
  if (!usage) return 0;
  return (usage.input_tokens || 0) + (usage.output_tokens || 0);
}

function createCursor(transcriptPath) {
  return { transcriptPath, byteOffset: 0, lastUuid: null };
}

// 앱이 처음 이 세션을 볼 때 사용: 현재 EOF를 시작점으로 삼아 "과거 히스토리"는 건너뛴다.
// (기존 긴 대화가 한꺼번에 backfill 되어 레벨이 폭등하는 것을 방지)
function createBaselineCursor(transcriptPath) {
  let size = 0;
  try { size = fs.statSync(transcriptPath).size; } catch { size = 0; }
  return { transcriptPath, byteOffset: size, lastUuid: null };
}

// cursor(byteOffset~EOF)만 읽어 새 assistant 줄의 토큰 합산. 갱신된 cursor 반환.
function sumNewTokens(cursor, filePath) {
  const cur = cursor && cursor.transcriptPath === filePath ? { ...cursor } : createCursor(filePath);
  let size = 0;
  try { size = fs.statSync(filePath).size; } catch { return { tokens: 0, cursor: cur }; }
  if (size < cur.byteOffset) cur.byteOffset = 0; // 파일 교체/회전

  let tokens = 0;
  let lastUuid = cur.lastUuid;
  if (size > cur.byteOffset) {
    const fd = fs.openSync(filePath, 'r');
    try {
      const len = size - cur.byteOffset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, cur.byteOffset);
      for (const line of buf.toString('utf8').split('\n')) {
        const s = line.trim();
        if (!s) continue;
        let o;
        try { o = JSON.parse(s); } catch { continue; }
        if (o.uuid && o.uuid === cur.lastUuid) continue; // 안전 중복 스킵
        if (o.type === 'assistant' && o.message && o.message.usage) {
          tokens += effectiveTokens(o.message.usage);
        }
        if (o.uuid) lastUuid = o.uuid;
      }
    } finally { fs.closeSync(fd); }
  }
  cur.byteOffset = size;
  cur.lastUuid = lastUuid;
  return { tokens, cursor: cur };
}

module.exports = { effectiveTokens, createCursor, createBaselineCursor, sumNewTokens };
