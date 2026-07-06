#!/usr/bin/env bash
# Deterministic tests for the Nightjar run-supervisor watchdog (nightjar-run.mjs).
# Uses fake "engine" scripts to simulate the pre-request freeze without needing
# to reproduce the rare real memory-pressure hang. "Reaching the model" is
# simulated by curling the proxy's generation endpoint (which increments the
# progress counter the watchdog polls). A freeze is simulated by `tail -f
# /dev/null` (blocks forever, no sleep, killed cleanly via the process group).
#
# Run: bash verify-watchdog.sh
set -u
export PATH="$HOME/.bun/bin:$PATH"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
PROXY="http://127.0.0.1:8086"
CURL_MODEL="curl -s -m 20 $PROXY/v1/chat/completions -H content-type:application/json -d {\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":4,\"stream\":false}"
pass=0; fail=0
check() { if [ "$1" = "$2" ]; then echo "PASS: $3"; pass=$((pass+1)); else echo "FAIL: $3 (got '$1' want '$2')"; fail=$((fail+1)); fi; }
grepcheck() { if echo "$2" | grep -q "$1"; then echo "PASS: $3"; pass=$((pass+1)); else echo "FAIL: $3 (missing '$1')"; fail=$((fail+1)); fi; }

# --- fake engines ---
cat > "$TMP/happy.sh" <<EOF
#!/usr/bin/env bash
$CURL_MODEL >/dev/null 2>&1
sleep 2   # stay alive after reaching the model, like a real streaming run
exit 0
EOF

cat > "$TMP/stall.sh" <<'EOF'
#!/usr/bin/env bash
exec tail -f /dev/null   # never contacts the model — simulates setup freeze
EOF

cat > "$TMP/recover.sh" <<EOF
#!/usr/bin/env bash
CF="$TMP/attempts"
n=\$(cat "\$CF" 2>/dev/null || echo 0); n=\$((n+1)); echo \$n > "\$CF"
if [ "\$n" -le 1 ]; then exec tail -f /dev/null; fi   # freeze first attempt only
$CURL_MODEL >/dev/null 2>&1
exit 0
EOF
chmod +x "$TMP"/*.sh

echo "== Scenario 1: happy path (engine reaches model immediately) =="
OUT=$(NIGHTJAR_ENGINE_CMD="bash $TMP/happy.sh" NIGHTJAR_FIRST_TOKEN_TIMEOUT_MS=6000 \
      bun "$DIR/nightjar-run.mjs" 2>&1); RC=$?
check "$RC" "0" "happy path exits 0"
grepcheck "progress detected" "$OUT" "happy path detects progress"

echo "== Scenario 2: freeze on attempt 1, AUTO-RECOVER on attempt 2 (key proof) =="
rm -f "$TMP/attempts"
OUT=$(NIGHTJAR_ENGINE_CMD="bash $TMP/recover.sh" NIGHTJAR_FIRST_TOKEN_TIMEOUT_MS=4000 NIGHTJAR_RUN_MAX_ATTEMPTS=3 \
      bun "$DIR/nightjar-run.mjs" 2>&1); RC=$?
check "$RC" "0" "auto-recover exits 0 (user sees success)"
grepcheck "FROZE" "$OUT" "detects the freeze on attempt 1"
grepcheck "recovered on attempt 2" "$OUT" "auto-restarts and succeeds on attempt 2"

echo "== Scenario 3: persistent freeze -> exhaust retries, clear error =="
OUT=$(NIGHTJAR_ENGINE_CMD="bash $TMP/stall.sh" NIGHTJAR_FIRST_TOKEN_TIMEOUT_MS=3000 NIGHTJAR_RUN_MAX_ATTEMPTS=2 \
      bun "$DIR/nightjar-run.mjs" 2>&1); RC=$?
check "$RC" "1" "persistent freeze exits non-zero"
grepcheck "all 2 attempts froze" "$OUT" "reports exhausted attempts"
grepcheck "low memory" "$OUT" "gives a user-actionable message"

echo "== Cleanup check: no orphaned frozen processes left behind =="
LEFT=$(pgrep -fc "tail -f /dev/null" 2>/dev/null || true); LEFT=${LEFT:-0}
check "$LEFT" "0" "no orphaned frozen child processes (process-group kill worked)"

rm -rf "$TMP"
echo ""; echo "==== watchdog: $pass passed, $fail failed ===="
[ "$fail" -eq 0 ]
