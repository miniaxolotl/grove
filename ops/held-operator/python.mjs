// -I alone still initializes site/global hooks. Disable that before ANY script
// or toolchain probe runs; do not admit those hooks into the OS code closure.
export const pythonExecutable = "/usr/bin/python3";
export const isolatedPythonArgs = (...args) => ["-I", "-S", "-B", ...args];
