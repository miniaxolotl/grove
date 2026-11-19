"""Bounded doctl PTY transport for one fixed read-only held endpoint.

Only public scope IDs/nonce enter argv. Provider credentials stay in doctl's
existing environment/custody. Raw console bytes never leave this process.
"""
import errno
import json
import os
import pty
import re
import select
import shlex
import signal
import sys
import time


def fail():
    raise ValueError("held_probe_unavailable")


def run():
    if len(sys.argv) != 8:
        fail()
    app, deployment, component, instance, challenge, mode, source = sys.argv[1:]
    uuid = r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"
    if not all(re.fullmatch(uuid, value) for value in (app, deployment)):
        fail()
    if component not in ("api", "worker") or not re.fullmatch(r"[A-Za-z0-9-]{1,160}", instance):
        fail()
    if not re.fullmatch(r"[a-f0-9]{64}", challenge):
        fail()
    if mode not in ("held", "lifecycle", "runtime") or (mode != "held" and not re.fullmatch(r"[a-f0-9]{40}", source)):
        fail()
    frame = "__GROVE_HELD_" + challenge + "__"
    path = "/_grove/release/" + mode
    code = '(async()=>{const headers={"X-Grove-Release-Challenge":' + json.dumps(challenge) + '};'
    if mode != "held":
        message = path + "\n" + challenge + "\n" + component + "\n" + source
        code += 'headers["X-Grove-Release-Proof"]=(await import("node:crypto")).createHmac("sha256",process.env.CURSOR_SECRET).update(' + json.dumps(message) + ').digest("hex");'
    code += ('const r=await fetch("http://127.0.0.1:"+(process.env.PORT||"26080")+' + json.dumps(path)
        + ',{headers,signal:AbortSignal.timeout(8000)});if(r.status!==200)process.exit(2);console.log('
        + json.dumps(frame) + '+JSON.stringify(await r.json())+' + json.dumps(frame) + ');})().catch(()=>process.exit(2))')
    command = "node -e " + shlex.quote(code) + "; exit\n"
    child, fd = pty.fork()
    if child == 0:
        os.execvp("doctl", ["doctl", "apps", "console", app, component, instance, "--deployment", deployment])
    sent = False
    output = bytearray()
    status = None
    deadline = time.monotonic() + 45
    try:
        while time.monotonic() < deadline:
            readable, _, _ = select.select([fd], [], [], min(1, max(0, deadline - time.monotonic())))
            if readable:
                try:
                    data = os.read(fd, 8192)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    data = b""
                output.extend(data)
                if len(output) > 131072:
                    fail()
                if not sent and re.search(rb"[$#>] ", output):
                    os.write(fd, command.encode())
                    sent = True
            exited, code_status = os.waitpid(child, os.WNOHANG)
            if exited:
                status = code_status
                break
        if status is None or not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
            fail()
        text = output.decode("utf8", errors="replace").replace("\r", "")
        replies = []
        for raw in re.findall(re.escape(frame) + r"(.*?)" + re.escape(frame), text):
            try:
                value = json.loads(raw)
                if isinstance(value, dict):
                    replies.append(value)
            except (ValueError, TypeError):
                pass
        if len(replies) != 1:
            fail()
        body = replies[0]
        fields = {"status", "role", "identity", "schema", "challenge"}
        if mode != "held":
            fields.update({"evidence", "approval" if mode == "runtime" else "receipt"})
        if set(body) != fields:
            fail()
        expected_status = "release_held" if mode == "held" else mode + "_verified"
        if body["status"] != expected_status or body["role"] != component or body["schema"] != "verified" or body["challenge"] != challenge:
            fail()
        identity = body["identity"]
        if mode != "held":
            if identity["source"] != source or not re.fullmatch(r"[a-f0-9]{64}", body["approval" if mode == "runtime" else "receipt"]):
                fail()
            evidence = body["evidence"]
            if set(evidence) != {"release", "receipt", "generation", "customers", "remoteVerified", "pending", "uncertain", "caughtUp", "authorityHash", "remoteHash", "control"}:
                fail()
            control = evidence["control"]
            if set(control) != {"phase", "approvalHash", "publicHash"} or control["phase"] not in ("reconcile", "handoff", "released", "public"):
                fail()
            for key in ("approvalHash", "publicHash"):
                if control[key] is not None and not re.fullmatch(r"[a-f0-9]{64}", control[key]):
                    fail()
            for key in ("release", "receipt", "authorityHash", "remoteHash"):
                if not re.fullmatch(r"[a-f0-9]{64}", evidence[key]):
                    fail()
            if not re.fullmatch(r"[0-9]{1,19}", evidence["generation"]) or type(evidence["caughtUp"]) is not bool:
                fail()
            for key in ("customers", "remoteVerified", "pending", "uncertain"):
                if type(evidence[key]) is not int or not 0 <= evidence[key] <= 9007199254740991:
                    fail()
        if set(identity) != {"schema", "source", "production", "tag", "run", "attempt", "digest", "publication"}:
            fail()
        if type(identity["schema"]) is not int or identity["schema"] != 1:
            fail()
        for key in ("source", "production"):
            if not re.fullmatch(r"[a-f0-9]{40}", identity[key]):
                fail()
        for key in ("run", "attempt"):
            if type(identity[key]) is not int or identity[key] < 1:
                fail()
        if not re.fullmatch(r"v\d+\.\d+\.\d+", identity["tag"]) or not re.fullmatch(r"sha256:[a-f0-9]{64}", identity["digest"]) or not re.fullmatch(r"[a-f0-9]{64}", identity["publication"]):
            fail()
        return body
    finally:
        os.close(fd)
        if status is None:
            try:
                os.killpg(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                os.waitpid(child, 0)
            except ChildProcessError:
                pass


def terminated(_signum, _frame):
    fail()


signal.signal(signal.SIGTERM, terminated)
try:
    print(json.dumps(run(), separators=(",", ":")))
except Exception:
    print("Private held-instance probe unavailable; retain release hold", file=sys.stderr)
    sys.exit(1)
