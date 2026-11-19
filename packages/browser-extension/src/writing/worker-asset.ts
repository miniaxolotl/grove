// esbuild binds Harper's worker-local fetch to this loader. In Firefox's
// offline mode worker fetch rejects moz-extension: resources, even though
// their bytes are in the installed ZIP. XHR reads them without a network.
export function fetch(input: RequestInfo | URL): Promise<Response> {
  const asset = new URL("harper.wasm", globalThis.location.href).href;
  if (String(input) !== asset)
    return Promise.reject(new Error("Expected the packaged Harper binary."));
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", asset);
    request.responseType = "arraybuffer";
    request.onload = () => {
      if (
        !(request.response instanceof ArrayBuffer) ||
        !request.response.byteLength
      ) {
        reject(new Error("Missing packaged Harper binary."));
        return;
      }
      resolve(
        new Response(request.response, {
          headers: { "Content-Type": "application/wasm" },
        }),
      );
    };
    request.onerror = () =>
      reject(new Error("Cannot read the packaged Harper binary."));
    request.send();
  });
}
