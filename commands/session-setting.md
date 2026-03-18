---
description: "세션 이름과 색상을 설정합니다. 예: /session-setting name:대시보드 color:blue. 세션 이름 변경, 세션 색상 변경, session name, session color 등의 요청에 사용하세요."
allowed-tools: Bash, Read
---

사용자가 입력한 인자: `$ARGUMENTS`

## 동작

### 1단계: 현재 세션의 session_id 찾기

```bash
PID=$$
CLAUDE_PID=""
while [ "$PID" -gt 1 ]; do
  CMD=$(ps -o comm= -p $PID 2>/dev/null)
  if [[ "$CMD" == *"node"* ]] || [[ "$CMD" == "claude" ]]; then
    CLAUDE_PID=$PID
  fi
  PID=$(ps -o ppid= -p $PID 2>/dev/null | tr -d ' ')
done

SESSION_ID=""
if [ -n "$CLAUDE_PID" ] && [ -f "/tmp/claude-sessions/pid-$CLAUDE_PID" ]; then
  SESSION_ID=$(cat "/tmp/claude-sessions/pid-$CLAUDE_PID")
fi
echo "CLAUDE_PID=$CLAUDE_PID SESSION_ID=$SESSION_ID"
```

session_id를 찾지 못하면 "세션 ID를 찾을 수 없습니다." 출력 후 종료.

### 2단계: 인자 파싱

`$ARGUMENTS`에서 다음을 파싱한다 (공백, 콜론 뒤 공백 등 유연하게 처리):
- `name:값` — 세션 이름
- `color:값` — 세션 색상 (허용: red, green, yellow, blue, magenta, cyan, white)
- `--save` — 현재 cwd를 config.json sessionDefaults에 저장 (다음 세션부터 자동 적용)
- `--list` — 저장된 기본값 목록 조회 후 종료
- `--remove` — 현재 cwd의 기본값 삭제 후 종료
- 인자가 비어있으면: 해당 세션의 .name과 .color 파일 삭제 (초기화)

**색상 검증**: 허용되지 않는 색상이 입력되면 "지원하지 않는 색상입니다. 허용: red, green, yellow, blue, magenta, cyan, white" 출력 후 종료.

### 3단계: 특수 플래그 처리

**`--list`인 경우:**
```bash
CONFIG_FILE="$HOME/.claude-dashboard/config.json"
if [ -f "$CONFIG_FILE" ]; then
  python3 -c "
import json
with open('$CONFIG_FILE') as f:
    data = json.load(f)
defaults = data.get('sessionDefaults', {})
if not defaults:
    print('저장된 기본값이 없습니다.')
else:
    for cwd, v in defaults.items():
        name = v.get('name', '-')
        color = v.get('color', '-')
        short = cwd.replace('$HOME', '~')
        print(f'  {short} → name:{name} color:{color}')
"
else
  echo "저장된 기본값이 없습니다."
fi
```
출력 후 종료.

**`--remove`인 경우:**
대시보드 API로 삭제를 시도하고, 실패 시 파일 직접 수정:
```bash
CWD=$(pwd)
curl -s -X DELETE "http://localhost:7420/api/session-defaults" \
  -H "Content-Type: application/json" \
  -d "{\"cwd\":\"$CWD\"}" --connect-timeout 1 --max-time 2 2>/dev/null || \
python3 -c "
import json, os
config_file = os.path.expanduser('~/.claude-dashboard/config.json')
with open(config_file) as f:
    data = json.load(f)
data.get('sessionDefaults', {}).pop('$CWD', None)
with open(config_file + '.tmp', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
os.rename(config_file + '.tmp', config_file)
"
```
"기본값 삭제됨: {cwd}" 출력 후 종료.

### 4단계: 이름/색상 적용

**A. /tmp 파일 저장 (statusline용):**
```bash
mkdir -p /tmp/claude-sessions
echo '이름' > /tmp/claude-sessions/{session_id}.name
echo '색상' > /tmp/claude-sessions/{session_id}.color
```

**B. 대시보드 세션 파일 업데이트:**
환경변수로 값을 전달하여 따옴표 안전성을 보장한다:
```bash
SESSION_FILE="$HOME/.claude-dashboard/sessions/${SESSION_ID}.json"
if [ -f "$SESSION_FILE" ]; then
  PARSED_NAME="이름" PARSED_COLOR="색상" python3 -c "
import json, os
with open(os.environ.get('SESSION_FILE', '')) as f:
    data = json.load(f)
name = os.environ.get('PARSED_NAME', '')
color = os.environ.get('PARSED_COLOR', '')
if name:
    data['projectName'] = name
    data['customName'] = True
if color:
    data['color'] = color
with open(os.environ.get('SESSION_FILE', '') + '.tmp', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
os.rename(os.environ.get('SESSION_FILE', '') + '.tmp', os.environ.get('SESSION_FILE', ''))
" 2>/dev/null
fi
```

**C. `--save` 플래그가 있으면 sessionDefaults에도 저장:**
대시보드 API로 저장을 시도하고, 실패 시 파일 직접 수정:
```bash
CWD=$(pwd)
curl -s -X PUT "http://localhost:7420/api/session-defaults" \
  -H "Content-Type: application/json" \
  -d "{\"cwd\":\"$CWD\",\"name\":\"이름\",\"color\":\"색상\"}" \
  --connect-timeout 1 --max-time 2 2>/dev/null || \
PARSED_NAME="이름" PARSED_COLOR="색상" CWD="$CWD" python3 -c "
import json, os
config_file = os.path.expanduser('~/.claude-dashboard/config.json')
try:
    with open(config_file) as f:
        data = json.load(f)
except:
    data = {}
if 'sessionDefaults' not in data:
    data['sessionDefaults'] = {}
entry = {}
name = os.environ.get('PARSED_NAME', '')
color = os.environ.get('PARSED_COLOR', '')
if name: entry['name'] = name
if color: entry['color'] = color
data['sessionDefaults'][os.environ['CWD']] = entry
with open(config_file + '.tmp', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
os.rename(config_file + '.tmp', config_file)
" 2>/dev/null
```

### 5단계: 출력

설정 시:
```
세션 설정 완료 (session: {session_id 앞 8자리})
 - name: {이름}
 - color: {색상}
```
`--save` 포함 시 추가:
```
 - saved: {cwd} (다음 세션부터 자동 적용)
```

초기화 시:
```
세션 설정 초기화됨
```

## 주의
- 파일 저장은 반드시 Bash의 echo 명령으로 한다 (Write 도구 사용 금지)
- 대시보드/config 파일 업데이트는 python3 원자적 쓰기 + 환경변수 전달 (hook이 파일을 자주 갱신하므로)
- 확인 질문 없이 바로 실행한다
- name만 주거나 color만 줘도 된다. 주어진 것만 업데이트한다.
