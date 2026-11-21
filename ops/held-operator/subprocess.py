"""Bounded Linux child-tree supervisor; no request detachment or host-wide kill.

Adopts double-forked/session-escaping descendants, fences signals with pidfds,
and acknowledges only after all owned children have been killed/reaped.
Private input/output travel through anonymous pipes, never argv or disk.
"""
import base64
import ctypes
import json
import os
import selectors
import signal
import subprocess
import sys
import time

if sys.argv[1:] == ["--toolchain"]:
    paths = {os.path.realpath(sys.executable)}
    with open('/proc/self/maps', encoding='utf-8') as mapped:
        for row in mapped:
            path = row.split()[-1]
            if path.startswith('/usr/') and os.path.isfile(path):
                paths.add(os.path.realpath(path))
    for module in list(sys.modules.values()):
        if getattr(module, "__name__", None) == "__main__":
            continue
        for field in ("__file__", "__cached__"):
            path = getattr(module, field, None)
            if path and os.path.isfile(path):
                paths.add(os.path.realpath(path))
    print(json.dumps({"files":sorted(paths)}))
    sys.exit(0)

os.umask(0o077)
request = json.load(sys.stdin)
assert ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0
assert hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal")
owner = os.getpid()
stopping = False
def interrupt(*_):
    global stopping
    stopping = True
signal.signal(signal.SIGTERM, interrupt)
signal.signal(signal.SIGINT, interrupt)

def identity(pid):
    try:
        with open(f"/proc/{pid}/stat", encoding="ascii") as f:
            fields = f.read().rsplit(")", 1)[1].split()
        return (int(fields[1]), fields[19], fields[0])
    except (FileNotFoundError, ProcessLookupError):
        return None

def descendants():
    rows = {}
    pending = [owner]
    while pending:
        parent = pending.pop()
        try:
            with open(f"/proc/{parent}/task/{parent}/children", encoding="ascii") as f:
                children = f.read().split()
        except FileNotFoundError:
            continue
        for text in children:
            pid = int(text)
            row = identity(pid)
            if row and row[0] == parent and pid not in rows:
                rows[pid] = row
                pending.append(pid)
    return rows

secret = None
if request.get("secretFd") is not None:
    secret = os.memfd_create("operator-private-input", os.MFD_CLOEXEC)
    data = base64.b64decode(request["secretFd"], validate=True)
    os.write(secret, data)
    os.lseek(secret, 0, os.SEEK_SET)
def secret_descriptor():
    if secret is not None and secret != 3:
        os.dup2(secret, 3)
        os.close(secret)
child = subprocess.Popen(request["argv"], cwd=request.get("cwd"), env=request["env"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    start_new_session=True, pass_fds=(() if secret is None else tuple({3, secret})),
    preexec_fn=(None if secret is None else secret_descriptor))
if secret is not None:
    os.close(secret)
data = memoryview(base64.b64decode(request["input"], validate=True))
select = selectors.DefaultSelector()
os.set_blocking(child.stdout.fileno(), False)
os.set_blocking(child.stdin.fileno(), False)
select.register(child.stdout, selectors.EVENT_READ)
if data:
    select.register(child.stdin, selectors.EVENT_WRITE)
else:
    child.stdin.close()
deadline = time.monotonic() + request["timeoutMs"]/1000
output = bytearray()
error = None
try:
    while True:
        if stopping or time.monotonic() >= deadline:
            error = "SUBPROCESS_TIMEOUT"
            break
        for key, _ in select.select(0.02):
            if key.fileobj is child.stdin:
                try:
                    written = os.write(child.stdin.fileno(), data[:65536])
                    data = data[written:]
                    if data:
                        continue
                except BrokenPipeError:
                    pass
                select.unregister(child.stdin)
                child.stdin.close()
            else:
                chunk = os.read(child.stdout.fileno(), 65536)
                if chunk:
                    output.extend(chunk)
                    if len(output) > request["maxBytes"]:
                        error = "SUBPROCESS_OUTPUT_LIMIT"
                        stopping = True
                        break
                else:
                    select.unregister(child.stdout)
        if child.poll() is not None:
            # Do not wait for inherited pipes held by an orphan before cleanup.
            break
finally:
    cleanup_deadline = time.monotonic() + 5
    uncertain = False
    while time.monotonic() < cleanup_deadline:
        for pid, row in descendants().items():
            fd = None
            try:
                fd = os.pidfd_open(pid)
                current = identity(pid)
                if current and current[1] == row[1]:
                    if current[2] != "Z":
                        signal.pidfd_send_signal(fd, signal.SIGKILL)
                elif current:
                    uncertain = True
            except ProcessLookupError:
                pass
            except OSError:
                uncertain = True
            finally:
                if fd is not None:
                    os.close(fd)
        while True:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
                if not pid:
                    break
                if pid == child.pid:
                    child.returncode = os.waitstatus_to_exitcode(status)
            except ChildProcessError:
                break
        if not descendants():
            break
        time.sleep(0.01)
    uncertain = uncertain or bool(descendants()) or child.returncode is None
    # Drain buffered output after the owned tree is gone, up to the same cap.
    while len(output) <= request["maxBytes"]:
        try:
            chunk = os.read(child.stdout.fileno(), 65536)
        except BlockingIOError:
            break
        if not chunk:
            break
        output.extend(chunk)
    select.close()
    child.stdout.close()
    if not child.stdin.closed:
        child.stdin.close()
    if uncertain:
        error = "SUBPROCESS_CLEANUP_UNCERTAIN"
    elif len(output) > request["maxBytes"]:
        error = "SUBPROCESS_OUTPUT_LIMIT"
    elif child.returncode != 0 and not error:
        error = "SUBPROCESS_FAILED"
    print(json.dumps({"error":error, "reaped":not uncertain,
        "output":base64.b64encode(output[:request["maxBytes"]]).decode("ascii")}))
