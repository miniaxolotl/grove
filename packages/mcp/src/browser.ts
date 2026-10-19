import { spawn } from "node:child_process";

export function openBrowser(url: URL, noBrowser: boolean) {
  console.error(`Continue in your browser: ${url.href}`);
  if (noBrowser) return;
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  const browser = spawn(command, [url.href], { stdio: "ignore" });
  browser.on("error", () => {});
  browser.unref();
}
