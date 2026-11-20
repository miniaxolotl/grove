"""Private independently provisioned SQLite authority. JSON stdin only.

No initialization, reset, schema repair, truncation or replay on ordinary opens.
Directory fds pin every path component. The privileged authority administrator is
trusted not to roll back the entire authority; mutable custody is not trusted.
"""
import fcntl
import json
import os
import re
import sqlite3
import stat
import sys
import time

if sys.argv[1:] == ["--toolchain"]:
    paths = {os.path.realpath(sys.executable)}
    with open('/proc/self/maps', encoding='utf-8') as mapped:
        for row in mapped:
            path = row.split()[-1]
            if path.startswith('/usr/') and os.path.isfile(path):
                paths.add(os.path.realpath(path))
    for name, module in list(sys.modules.items()):
        if name == "__main__":
            continue
        for field in ("__file__", "__cached__"):
            path = getattr(module, field, None)
            if path and os.path.isfile(path):
                paths.add(os.path.realpath(path))
    print(json.dumps({"python": sys.version.split()[0], "sqlite": sqlite3.sqlite_version, "files": sorted(paths)}))
    sys.exit(0)


def need(value, code):
    if not value:
        raise ValueError(code)


def ident(s):
    return str(s.st_dev) + ":" + str(s.st_ino)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def directory(path):
    need(isinstance(path, str) and path == os.path.abspath(path), "AUTHORITY_PATH_REJECTED")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        parts = path.split("/")[1:]
        for i, part in enumerate(parts):
            need(part and part not in (".", ".."), "AUTHORITY_PATH_REJECTED")
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            s = os.fstat(fd)
            private = i == len(parts) - 1
            need(s.st_uid in (0, os.getuid()) and not s.st_mode & (0o077 if private else 0o022)
                 and (not private or s.st_uid == os.getuid()), "AUTHORITY_DIRECTORY_REJECTED")
        return fd
    except BaseException:
        os.close(fd)
        raise


FIELDS = {"schema", "id", "app", "custodyId", "root", "rootIdentity", "dbIdentity", "workRoot", "workIdentity", "source", "codeHash"}
GLOBAL = {"schema", "id", "app", "root", "rootIdentity", "dbIdentity"}
DB = "authority.sqlite3"
def global_identity(d):
    return {k:d[k] for k in GLOBAL}


def validate(d):
    need(isinstance(d, dict) and set(d) == FIELDS and d["schema"] == 2, "AUTHORITY_DESCRIPTOR_REJECTED")
    for key in ("id", "custodyId"):
        need(re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", d[key]), "AUTHORITY_DESCRIPTOR_REJECTED")
    need(re.fullmatch(r"[a-f0-9]{40}", d["source"]), "AUTHORITY_SOURCE_REJECTED")
    need(d["app"] == "3aef47f9-3724-4f21-9cad-8c4eb5644af0" and re.fullmatch(r"[a-f0-9]{64}", d["codeHash"]), "AUTHORITY_CODE_OR_APP_REJECTED")
    common = os.path.commonpath([d["root"], d["workRoot"]])
    need(common not in (d["root"], d["workRoot"]), "AUTHORITY_ROOTS_NOT_SEPARATE")


def provision(p):
    need(set(p) == {"root", "workRoot", "source", "id", "custodyId", "codeHash", "app"}, "AUTHORITY_PROVISION_REJECTED")
    af = directory(p["root"])
    wf = directory(p["workRoot"])
    dbfd = None
    try:
        need(not any(name in os.listdir(af) for name in (DB, DB+"-wal", DB+"-shm", "identity.json")), "AUTHORITY_ALREADY_PROVISIONED")
        dbfd = os.open(DB, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=af)
        d = {**p, "schema": 2, "rootIdentity": ident(os.fstat(af)), "workIdentity": ident(os.fstat(wf)), "dbIdentity": ident(os.fstat(dbfd))}
        validate(d)
        db = sqlite3.connect("/proc/self/fd/" + str(af) + "/" + DB, timeout=5)
        try:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=FULL")
            need(db.execute("PRAGMA journal_mode").fetchone()[0] == "wal" and db.execute("PRAGMA synchronous").fetchone()[0] == 2, "AUTHORITY_DURABILITY_REJECTED")
            db.executescript("""
                PRAGMA application_id=1196576598;
                PRAGMA user_version=2;
                CREATE TABLE meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1), descriptor TEXT NOT NULL, clock INTEGER NOT NULL);
                CREATE TABLE installations(custody_id TEXT PRIMARY KEY, work_root TEXT NOT NULL UNIQUE, descriptor TEXT NOT NULL);
                CREATE TABLE journals(key TEXT PRIMARY KEY, binding TEXT NOT NULL, sequence INTEGER NOT NULL, hash TEXT);
                CREATE TABLE windows(app TEXT PRIMARY KEY, fence INTEGER NOT NULL, record TEXT NOT NULL);
                CREATE TABLE effects(app TEXT NOT NULL, command_hash TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('intent','verified')), record TEXT NOT NULL);
                CREATE UNIQUE INDEX one_uncertain_effect ON effects(app) WHERE state='intent';
            """)
            db.execute("INSERT INTO meta VALUES(1,?,?)", (canonical(global_identity(d)), int(time.time()*1000)))
            db.execute("INSERT INTO installations VALUES(?,?,?)", (d["custodyId"], d["workRoot"], canonical(d)))
            db.commit()
            db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            db.close()
        os.fsync(dbfd)
        identity_fd = os.open("identity.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=af)
        try:
            os.write(identity_fd, (canonical(d)+"\n").encode())
            os.fsync(identity_fd)
        finally:
            os.close(identity_fd)
        os.fsync(af)
        return d
    finally:
        if dbfd is not None:
            os.close(dbfd)
        os.close(af)
        os.close(wf)


def window_operation(db, d, op, p):
    b = p.get("binding", {})
    now = int(time.time()*1000)
    # The provisioned source is identity provenance, not a per-source lock key.
    # Current source is independently bound by the signed window and code review.
    need(b.get("source") == d["source"] and b.get("app") == d["app"] and b.get("authorityId") == d["id"] and b.get("custodyId") == d["custodyId"], "WINDOW_IDENTITY_MISMATCH")
    app, command = b.get("app"), p.get("commandHash", "")
    need(isinstance(app, str) and re.fullmatch(r"[a-f0-9-]{36}", app) and re.fullmatch(r"[a-f0-9]{64}", command), "WINDOW_BINDING_REJECTED")
    observed = p.get("observed", {})
    need(all(re.fullmatch(r"[a-f0-9]{64}", observed.get(k, "")) for k in ("state", "settings", "instances")) and isinstance(observed.get("generation"), str), "WINDOW_PROVIDER_STATE_REJECTED")
    pending = db.execute("SELECT command_hash,record FROM effects WHERE app=? AND state='intent'", (app,)).fetchone()
    owner = p.get("owner", "")
    need(re.fullmatch(r"[a-f0-9-]{36}", owner), "WINDOW_OWNER_REJECTED")
    def target(record):
        return record.get("kind") == "provider" and record["source"] == b["source"] and record["digest"] == b["digest"] and observed["settings"] == record["proposed"] and observed["generation"] != record["generation"]
    def sql_target(record):
        return record.get("kind") in ("sql", "migration") and record["source"] == b["source"] and record["proposed"] == p.get("proofHash") and record["expected"] == observed["state"]
    if op == "window-readback":
        if pending and pending[0] == command:
            need(target(json.loads(pending[1])) or sql_target(json.loads(pending[1])), "WINDOW_ACCEPTANCE_UNCERTAIN")
        else:
            row = db.execute("SELECT record FROM effects WHERE app=? AND command_hash=?", (app, command)).fetchone()
            if row is None:
                need(observed["settings"] == p.get("proposed"), "WINDOW_ACCEPTANCE_UNCERTAIN")
            else:
                need(target(json.loads(row[0])) or sql_target(json.loads(row[0])), "WINDOW_ACCEPTANCE_UNCERTAIN")
        return {"observed": True, "readOnly": True}
    need(type(b.get("issuedAt")) is int and type(b.get("expiresAt")) is int and b["issuedAt"] <= now < b["expiresAt"] and 0 < b["expiresAt"]-b["issuedAt"] <= 900000, "WINDOW_EXPIRED")
    ttl = b.get("leaseMs")
    need(type(ttl) is int and 1000 <= ttl <= 300000, "WINDOW_LEASE_REJECTED")
    boot = open("/proc/sys/kernel/random/boot_id", encoding="ascii").read().strip()
    row = db.execute("SELECT fence,record FROM windows WHERE app=?", (app,)).fetchone()
    fence, lease = (row[0], json.loads(row[1])) if row else (0, None)
    active = lease and lease["expiresAt"] > now
    resolving = op in ("window-resolve-provider", "window-resolve-migration", "window-resolve-sql", "window-resolve-idle")
    if resolving:
        need(lease and not lease.get("released") and p["certificateHash"] != lease["certificate"] and b["issuedAt"] > lease["binding"]["issuedAt"], "WINDOW_RESOLUTION_REQUIRES_FRESH_EXCLUSION")
        if op == "window-resolve-idle":
            need(not pending and command == lease["command"] and b["source"] == lease["binding"]["source"] and b["custodyId"] == lease["binding"]["custodyId"] and observed == lease.get("observed"), "WINDOW_ACCEPTANCE_UNCERTAIN")
        else:
            need(pending and pending[0] == command, "WINDOW_ACCEPTANCE_UNCERTAIN")
            prior = json.loads(pending[1])
            need(target(prior) if op == "window-resolve-provider" else sql_target(prior), "WINDOW_RESOLUTION_PROOF_REJECTED")
            db.execute("UPDATE effects SET state='verified' WHERE command_hash=?", (command,))
        lease["expiresAt"] = 0
        lease["released"] = True
        db.execute("UPDATE windows SET record=? WHERE app=?", (canonical(lease), app))
        return {"verified": True, "authorityOnly": True}
    need(not lease or lease.get("released") or (active and lease["boot"] == boot and lease["mono"] > time.monotonic()), "WINDOW_QUARANTINED")
    if op == "window-assert":
        if pending:
            need(pending[0] == command and active and lease["owner"] == owner, "WINDOW_ACCEPTANCE_UNCERTAIN")
        need(not active or (lease["owner"] == owner and lease["command"] == command and lease["boot"] == boot), "WINDOW_BUSY")
        if not active:
            fence += 1
        expires = min(now + ttl, b["expiresAt"])
        lease = {"owner": owner, "command": command, "boot": boot, "expiresAt": expires, "mono": time.monotonic() + (expires-now)/1000, "certificate": p["certificateHash"], "binding": b, "observed":observed, "released":False}
        db.execute("INSERT INTO windows VALUES(?,?,?) ON CONFLICT(app) DO UPDATE SET fence=excluded.fence,record=excluded.record", (app, fence, canonical(lease)))
        return {"fence": fence, "expiresAt": expires, "owner": owner}
    need(lease and lease["owner"] == owner and lease["command"] == command and fence == p.get("fence") and lease["boot"] == boot and lease["expiresAt"] > now and lease["mono"] > time.monotonic() and lease["certificate"] == p["certificateHash"], "WINDOW_LEASE_DRIFT")
    if op == "window-prepare":
        need(observed["state"] == p.get("expected"), "WINDOW_PROVIDER_DRIFT")
        record = {"source": b["source"], "digest": b["digest"], "proposed": p["proposed"], "expected":observed["state"], "generation": observed["generation"], "owner": owner, "fence": fence, "kind": p.get("kind", "provider")}
        try:
            db.execute("INSERT INTO effects VALUES(?,?,'intent',?)", (app, command, canonical(record)))
        except sqlite3.IntegrityError:
            raise ValueError("WINDOW_EFFECT_ALREADY_CONSUMED") from None
        return {"intentPersisted": True, "fence": fence}
    if op == "window-finish":
        need(pending and pending[0] == command, "WINDOW_ACCEPTANCE_UNCERTAIN")
        prior=json.loads(pending[1])
        need(target(prior) or sql_target(prior), "WINDOW_ACCEPTANCE_UNCERTAIN")
        db.execute("UPDATE effects SET state='verified' WHERE command_hash=?", (command,))
        lease["expiresAt"] = 0
        lease["released"] = True
        db.execute("UPDATE windows SET record=? WHERE app=?", (canonical(lease), app))
        return {"verified": True}
    if op == "window-release":
        need(not pending, "WINDOW_ACCEPTANCE_UNCERTAIN")
        lease["expiresAt"] = 0
        lease["released"] = True
        db.execute("UPDATE windows SET record=? WHERE app=?", (canonical(lease), app))
        return {"released": True}
    raise ValueError("WINDOW_OPERATION_REJECTED")


def operate(d, op, p):
    validate(d)
    af = directory(d["root"])
    wf = directory(d["workRoot"])
    fd = None
    db = None
    writes = op in ("register", "reserve", "advance", "window-assert", "window-prepare", "window-finish", "window-release", "window-resolve-migration", "window-resolve-provider", "window-resolve-idle", "window-resolve-sql")
    try:
        need(ident(os.fstat(af)) == d["rootIdentity"] and ident(os.fstat(wf)) == d["workIdentity"], "AUTHORITY_ROOT_IDENTITY_CHANGED")
        fd = os.open(DB, (os.O_RDWR if writes else os.O_RDONLY) | os.O_NOFOLLOW, dir_fd=af)
        s = os.fstat(fd)
        need(stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid() and s.st_nlink == 1 and not s.st_mode & 0o077 and ident(s) == d["dbIdentity"], "AUTHORITY_DB_IDENTITY_CHANGED")
        fcntl.flock(fd, fcntl.LOCK_EX)
        # EXCLUSIVE locking uses a private WAL index: read-only operations do not
        # write shm reader marks, create sidecars, checkpoint, or update clocks.
        # SQLite needs a writable fd for EXCLUSIVE byte-range locks even for a
        # query-only connection. Disable *all* checkpoint-on-close behavior and
        # use a private WAL index; the read path executes no mutating statement.
        uri = "file:/proc/self/fd/" + str(af) + "/" + DB + "?mode=rw"
        db = sqlite3.connect(uri, uri=True, timeout=5, isolation_level=None)
        need(hasattr(db, "setconfig"), "AUTHORITY_SQLITE_TOOLCHAIN_UNSUPPORTED")
        db.setconfig(sqlite3.SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, True)
        db.execute("PRAGMA wal_autocheckpoint=0")
        db.execute("PRAGMA locking_mode=EXCLUSIVE")
        db.execute("PRAGMA trusted_schema=OFF")
        need(db.execute("PRAGMA journal_mode").fetchone()[0] == "wal", "AUTHORITY_WAL_REQUIRED")
        if writes:
            db.execute("PRAGMA synchronous=FULL")
            need(db.execute("PRAGMA synchronous").fetchone()[0] == 2, "AUTHORITY_FULL_REQUIRED")
            db.execute("BEGIN IMMEDIATE")
        else:
            db.execute("PRAGMA query_only=ON")
        need(db.execute("PRAGMA application_id").fetchone()[0] == 1196576598 and db.execute("PRAGMA user_version").fetchone()[0] == 2, "AUTHORITY_SCHEMA_REJECTED")
        meta = db.execute("SELECT descriptor,clock FROM meta WHERE singleton=1").fetchone()
        need(meta and meta[0] == canonical(global_identity(d)), "AUTHORITY_IDENTITY_MISMATCH")
        registration = db.execute("SELECT descriptor FROM installations WHERE custody_id=?", (d["custodyId"],)).fetchone()
        need(registration and registration[0] == canonical(d), "AUTHORITY_INSTALLATION_IDENTITY_MISMATCH")
        need(int(time.time()*1000) >= meta[1] - 250, "AUTHORITY_CLOCK_REVERSED")
        if op == "status":
            result = {"id": d["id"], "custodyId": d["custodyId"], "source": d["source"], "workIdentity": d["workIdentity"]}
        elif op == "register":
            need(set(p) == {"workRoot", "source", "custodyId", "codeHash"}, "AUTHORITY_REGISTRATION_REJECTED")
            registered_fd = directory(p["workRoot"])
            try:
                result = {**d, **p, "workIdentity":ident(os.fstat(registered_fd))}
                validate(result)
                db.execute("INSERT INTO installations VALUES(?,?,?)", (result["custodyId"], result["workRoot"], canonical(result)))
            finally:
                os.close(registered_fd)
        elif op.startswith("window-"):
            result = window_operation(db, d, op, p)
        else:
            key = p.get("key", "")
            need(isinstance(key, str) and len(key) <= 256 and ".." not in key and re.fullmatch(r"[a-zA-Z0-9_/-]+/[a-f0-9-]{36}\.jsonl", key), "AUTHORITY_KEY_REJECTED")
            need(p.get("context", {}).get("rootIdentity") == d["workIdentity"], "AUTHORITY_WORK_IDENTITY_MISMATCH")
            if op == "reserve":
                deadline = p["context"].get("expiresAt")
                need(deadline is None or (type(deadline) is int and deadline > int(time.time()*1000)), "QUALIFICATION_APPROVAL_EXPIRED")
                binding = p["context"].get("binding", "")
                need(re.fullmatch(r"[a-f0-9]{64}", binding), "AUTHORITY_BINDING_REJECTED")
                try:
                    db.execute("INSERT INTO journals VALUES(?,?,0,NULL)", (key, binding))
                except sqlite3.IntegrityError:
                    raise ValueError("APPROVAL_ALREADY_CONSUMED") from None
                result = None
            elif op == "advance":
                old, new = p["old"], p["next"]
                need(type(old["sequence"]) is int and new["sequence"] == old["sequence"]+1 and re.fullmatch(r"[a-f0-9]{64}", new["hash"]), "AUTHORITY_HEAD_REJECTED")
                count = db.execute("UPDATE journals SET sequence=?,hash=? WHERE key=? AND sequence=? AND hash IS ?", (new["sequence"], new["hash"], key, old["sequence"], old["hash"])).rowcount
                need(count == 1, "JOURNAL_ANCHOR_CONFLICT")
                result = None
            elif op == "head":
                row = db.execute("SELECT sequence,hash FROM journals WHERE key=?", (key,)).fetchone()
                need(row is not None, "JOURNAL_ANCHOR_MISSING")
                result = {"sequence": row[0], "hash": row[1]}
            else:
                raise ValueError("AUTHORITY_OPERATION_REJECTED")
        need(ident(os.stat(DB, dir_fd=af, follow_symlinks=False)) == d["dbIdentity"], "AUTHORITY_DB_IDENTITY_CHANGED")
        if writes:
            db.execute("UPDATE meta SET clock=? WHERE singleton=1", (int(time.time()*1000),))
            db.execute("COMMIT")
            if os.environ.get("GROVE_AUTHORITY_FIXTURE_CRASH") == "after_commit":
                os._exit(91)
            db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            os.fsync(fd)
            os.fsync(af)
        return result
    finally:
        if db is not None:
            db.close()
        if fd is not None:
            os.close(fd)
        os.close(af)
        os.close(wf)


try:
    raw = sys.stdin.buffer.read(1024*1024+1)
    need(len(raw) <= 1024*1024, "AUTHORITY_INPUT_LIMIT")
    request = json.loads(raw)
    result = provision(request["parameters"]) if request["operation"] == "provision" else operate(request["descriptor"], request["operation"], request.get("parameters", {}))
    print(json.dumps({"ok": True, "result": result}, separators=(",", ":")))
except Exception as error:
    code = str(error) if isinstance(error, ValueError) and re.fullmatch(r"[A-Z_]{2,80}", str(error)) else getattr(error, "sqlite_errorname", "AUTHORITY_FAILED")
    print(json.dumps({"ok": False, "error": code}, separators=(",", ":")))
    sys.exit(2)
