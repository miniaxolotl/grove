"""Native Firefox smoke test. Uses an isolated profile and synthetic HTTP/auth only.

Run after pnpm build:extension with MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1.
No geckodriver, user profile, real account or provider configuration is used.
"""
import json
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import time

base = pathlib.Path(os.environ.get("TMPDIR", "/tmp/opencode"))
base.mkdir(parents=True, exist_ok=True)
profile = tempfile.mkdtemp(prefix="grove-firefox-", dir=base)
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
pathlib.Path(profile, "user.js").write_text('user_pref("marionette.port", %d);\n' % port)
log = open(pathlib.Path(profile, "firefox.log"), "w")
process = subprocess.Popen([
    os.environ.get("FIREFOX_BINARY", shutil.which("firefox") or "firefox"),
    "-headless", "-no-remote", "-profile", profile, "--marionette",
], stdout=log, stderr=log)
try:
    deadline = time.monotonic() + 30
    while True:
        try:
            connection = socket.create_connection(("127.0.0.1", port), timeout=2)
            break
        except OSError:
            if time.monotonic() > deadline:
                raise RuntimeError("Firefox did not start; see " + profile)
            time.sleep(.1)
    connection.settimeout(30)
    stream = connection.makefile("rb")

    def receive():
        size = b""
        while True:
            character = stream.read(1)
            if character == b":":
                break
            if not character:
                raise RuntimeError("Firefox disconnected")
            size += character
        return json.loads(stream.read(int(size)))

    receive()
    counter = 0

    def call(name, payload=None):
        global counter
        counter += 1
        value = json.dumps([0, counter, name, payload or {}]).encode()
        connection.sendall(str(len(value)).encode() + b":" + value)
        while True:
            result = receive()
            if isinstance(result, list) and result[0] == 1 and result[1] == counter:
                if result[2]:
                    raise RuntimeError(result[2])
                return result[3]

    def script(source):
        return call("WebDriver:ExecuteScript", {"script": source, "args": []})["value"]

    def asynchronous(source):
        result = call("WebDriver:ExecuteAsyncScript", {
            "script": "const done=arguments[arguments.length-1]; (async()=>{" + source +
            "})().then(done,e=>done({error:e.message}));", "args": [],
        })["value"]
        assert not isinstance(result, dict) or "error" not in result, result
        return result

    def wait_for(expression):
        end = time.monotonic() + 10
        while True:
            value = script("return " + expression + ";")
            if value:
                return value
            if time.monotonic() > end:
                raise RuntimeError("Timed out: " + expression)
            time.sleep(.1)

    session = call("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {}}})
    addon = call("Addon:Install", {
        "path": os.path.abspath("packages/browser-extension/dist/grove-firefox.zip"),
        "temporary": True,
    })
    assert addon["value"] == "grove@usegrove.cloud"
    call("Marionette:SetContext", {"value": "chrome"})
    uuid = script('return JSON.parse(Services.prefs.getStringPref("extensions.webextensions.uuids"))["grove@usegrove.cloud"];')
    call("Marionette:SetContext", {"value": "content"})
    call("WebDriver:Navigate", {"url": "moz-extension://" + uuid + "/panel.html"})
    assert script("return document.title;") == "Grove"
    asynchronous('''
      const host=window.browser,background=await host.runtime.getBackgroundPage();
      const key=`oauth:https://api.usegrove.cloud|https://clerk.usegrove.cloud|${host.identity.getRedirectURL()}`;
      await host.storage.session.set({[`${key}:tokens`]:{access_token:"fixture-token",token_type:"Bearer",expires_in:3600},[`${key}:expires`]:Date.now()+3600000});
      const accountId="00000000-0000-4000-a000-000000000001",connectionId="00000000-0000-4000-a000-000000000002",notes=[];
      background.fetch=async(input,init)=>{
        const path=new URL(String(input)).pathname;let data;
        if(path==="/v1/browser/connect")data={accountId,connectionId,capabilities:["memory:read","memory:write"],grant:{personal:true,allProjects:false,projectIds:[]}};
        else if(path==="/v1/tools/notebooks")data={items:[],nextCursor:null};
        else if(path==="/v1/browser/captures"){
          const body=JSON.parse(init.body);data={id:crypto.randomUUID(),projectId:null,content:body.content,kind:"fact",version:1,status:"active",source:{agent:"api"},taskId:null,expiresAt:null,purgeAt:null,indexing:"pending",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};notes.push(data);
        }else if(path==="/v1/memories/search"||path==="/v1/browser/pages")data={items:notes,nextCursor:null};
        else if(path.startsWith("/v1/memories/"))data=notes.find(note=>path.endsWith(note.id));
        else throw new Error("Unexpected fixture request");
        return Response.json({success:true,data});
      };
      return true;
    ''')
    call("WebDriver:Refresh")
    wait_for('!document.getElementById("workspace").hidden')
    script('document.getElementById("note").value="# Native Firefox note\\n\\n- **Readable**";document.getElementById("note").dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("capture-form").requestSubmit();')
    wait_for('document.getElementById("save-state").textContent.includes("Saved.")')
    script('document.querySelector("[data-nav=search]").click();document.getElementById("query").value="native Firefox";document.getElementById("query").dispatchEvent(new Event("input",{bubbles:true}));')
    assert wait_for('document.querySelector(".note-row .note-title")?.textContent') == "Native Firefox note"
    assert script('return document.querySelector(".note-row .excerpt").textContent;') == "Readable"
    script('document.querySelector(".note-row button").click();')
    wait_for('document.getElementById("reader").open')
    assert script('return document.querySelector("#reader-content h2").textContent;') == "Native Firefox note"
    assert script('return document.querySelector("#reader-content strong").textContent;') == "Readable"
    script('document.getElementById("close-reader").click();')
    script('document.querySelector(".note-row input").click();document.getElementById("review-context").click();')
    wait_for('document.getElementById("context").open&&document.getElementById("context-text").value.includes("Grove source:")')
    # A real WebDriver click supplies the gesture for the native Firefox API.
    script('document.getElementById("context").close();const button=document.createElement("button");button.id="native-host-probe";button.textContent="Native sidebar probe";button.onclick=()=>window.browser.sidebarAction.open();document.body.prepend(button);')
    element = call("WebDriver:FindElement", {"using": "css selector", "value": "#native-host-probe"})
    call("WebDriver:ElementClick", {"id": element["value"]["element-6066-11e4-a52e-4f735466cecf"]})
    call("Marionette:SetContext", {"value": "chrome"})
    sidebar = script("return {open:window.SidebarController.isOpen,id:window.SidebarController.currentID};")
    assert sidebar == {"open": True, "id": "grove_usegrove_cloud-sidebar-action"}, sidebar
    print("PASS Firefox", session["capabilities"]["browserVersion"], "temporary install, native sidebar, capture, search, context (synthetic HTTP/auth)")
    call("Marionette:Quit", {"flags": ["eAttemptQuit"]})
finally:
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.terminate()
        process.wait(timeout=10)
    log.close()
