"""Korean text for the architecture infographic. Every value is checked against the repository at v0.8.0."""
from arch_page import render

T = dict(
    title="Seoul OpenData MCP 아키텍처",
    sub_en="Access Paths, Request Pipeline, Snapshot Store, Quota Protection",
    sub_ko="v0.8.0 구조 요약",
    s1=("접근 경로 3종", "서버 코드는 동일, 인증 방식만 차이"),
    lanes=[
        dict(caller=("로컬 MCP 클라이언트", "Claude Desktop, Claude Code"), link="stdio, 인증 없음",
             tag="AWS 의존성 없음", color="green", run=("로컬 프로세스", "npx -y seoul-opendata-mcp")),
        dict(caller=("AgentCore 호출자", "AWS 자격 증명 보유"), link="IAM SigV4 서명",
             tag="linux/arm64 컨테이너", color="blue", run=("AgentCore Runtime", "POST /mcp, 상태 없는 HTTP")),
        dict(caller=("워크숍 참가자", "공용 코드 1개 공유"), link="Bearer 코드",
             gw=("AgentCore Gateway", "대상 seoul, seoul___<tool>"),
             fn=("인터셉터 Lambda", "코드, 만료, 분당 한도 검사"),
             run=("전용 Runtime", "Gateway IAM 역할로 호출")),
    ],
    server=("MCP 서버", "23 tools", "핫스팟 121곳", "데이터셋 카탈로그 52종"),
    s2=("요청 처리와 사전 적재", "업스트림 호출은 단일 경로, 느린 데이터는 스냅샷 우선"),
    steps=[
        ("MCP tool", "23개, zod 입력 검증", "blue", False),
        ("SeoulApiClient", "저장소, 캐시, 키 풀 순서 조회", "purple", False),
        ("서울 열린데이터광장 API", "openapi, swopenapi", None, False),
        ("unwrap", "응답 봉투 8종 해제", "blue", False),
        ("normalize", "도메인별 필드 정규화", "blue", False),
        ("ok() 봉투", "{data, asOf, source, notes}", "green", True),
    ],
    store=dict(
        s3=("S3 스냅샷 저장소", "store/v1, gzip JSON 스냅샷"),
        tags=["규칙 표 37종", "90일 보관"],
        fn=("수집 Lambda", "35종 수집, 쿼터 장부 기록"),
        sched=("EventBridge Scheduler", "매일 05:00 KST 예시, 선택 사항"),
        read="저장소 우선 조회",
        call="수집 1회 약 100회 호출",
    ),
    insight=("느린 데이터 37종 스냅샷 응답", "서울 API 호출 0회, 규칙 표 밖 요청은 캐시와 서울 API 경로 유지"),
    s3=("쿼터 보호 3단", "키당 하루 1,000회 기본 한도 방어"),
    cards=[
        ("키 풀", "purple", "예산 = 키 수 × 한도",
         ["쉼표로 여러 키 등록", "하루 한도 미만인 첫 키 사용", "ERROR-337 키는 10분 제외, 다음 키로 1회 재시도"]),
        ("2단 캐시", "yellow", "stale-while-revalidate",
         ["L1 프로세스 메모리, LRU 1,000개", "L2 DynamoDB, 세션 간 공유", "soft TTL 15초~24시간, hard TTL 24시간"]),
        ("쿼터 장부", "orange", "KST 하루 단위",
         ["키별 호출 수 집계", "80% 도달 시 사용량 안내", "100% 도달 시 캐시만으로 응답"]),
    ],
    s4=("워크숍 Gateway 검사", "코드, 만료, 분당 한도 순서"),
    head=("검사 항목", "실패 시 응답"),
    rows=[
        ("코드 일치", "Bearer 코드의 sha256 비교", "403 코드 오류"),
        ("만료 시각", "KST 만료 시각 경과 확인", "403 코드 만료"),
        ("분당 한도", "tools/call 분당 120회, 기본값", "isError 응답"),
    ],
    **{"pass": "통과 시 Gateway IAM 역할로 전용 Runtime 호출"},
    ddb=("DynamoDB 테이블 1개", "캐시, 쿼터 장부, 분당 카운터 저장"),
    note="v0.8.0 기준, 수치는 기본 설정값, 수집 호출 수는 2026-11-22 첫 수집 측정값(98회)",
)


def landscape(theme):
    return render(T, theme)
