"""English text for the architecture infographic. Every value is checked against the repository at v0.7.0."""
from arch_page import render

T = dict(
    title="Seoul OpenData MCP Architecture",
    sub_en="Access Paths, Request Pipeline, Quota Protection",
    sub_ko="as of v0.7.0",
    s1=("Three Access Paths", "Same server code, different authentication"),
    lanes=[
        dict(caller=("Local MCP client", "Claude Desktop, Claude Code"), link="stdio, no auth",
             tag="no AWS dependency", color="green", run=("Local process", "npx -y seoul-opendata-mcp")),
        dict(caller=("AgentCore caller", "holds AWS credentials"), link="IAM SigV4",
             tag="linux/arm64 container", color="blue", run=("AgentCore Runtime", "POST /mcp, stateless HTTP")),
        dict(caller=("Workshop participant", "one shared code"), link="Bearer code",
             gw=("AgentCore Gateway", "target seoul, seoul___<tool>"),
             fn=("Interceptor Lambda", "code, expiry, rate checks"),
             run=("Dedicated Runtime", "called with the gateway role")),
    ],
    server=("MCP server", "23 tools", "121 hotspots", "52-dataset catalog"),
    s2=("Request Pipeline", "Every upstream call takes one path"),
    steps=[
        ("MCP tool", "23 tools, zod input checks", "blue", False),
        ("SeoulApiClient", "key pool, cache, one retry", "purple", False),
        ("Seoul Open Data Plaza API", "openapi, swopenapi", None, False),
        ("unwrap", "8 envelope shapes", "blue", False),
        ("normalize", "per-domain field mapping", "blue", False),
        ("ok() envelope", "{data, asOf, source, notes}", "green", True),
    ],
    s3=("Quota Protection in Three Layers", "Guards the default 1,000 calls per key per day"),
    cards=[
        ("Key pool", "purple", "budget = keys × limit",
         ["Several comma-separated keys", "First key under its daily limit",
          "ERROR-337 key rests 10 min, one retry with the next key"]),
        ("Two-tier cache", "yellow", "stale-while-revalidate",
         ["L1 in process memory, LRU of 1,000", "L2 in DynamoDB, shared by sessions",
          "Soft TTL 15 s~24 h, hard TTL 24 h"]),
        ("Quota ledger", "orange", "per KST day",
         ["Call count per key", "Usage note at 80%", "Cache-only answers at 100%"]),
    ],
    insight=("One cache entry for every key",
             "The cache key replaces the key segment with {key}, so a response fetched with any key is reused"),
    s4=("Workshop Gateway Checks", "Code, expiry, then per-minute limit"),
    head=("Check", "On failure"),
    rows=[
        ("Code match", "sha256 of the Bearer code", "403 invalid code"),
        ("Expiry", "Expiry time in KST", "403 expired code"),
        ("Rate limit", "120 tools/call per minute by default", "isError result"),
    ],
    **{"pass": "On pass, the gateway calls the dedicated Runtime with its IAM role"},
    ddb=("One DynamoDB table", "Cache, quota ledger and per-minute counters"),
    note="As of v0.7.0. Numbers are default settings",
)


def landscape(theme):
    return render(T, theme)
