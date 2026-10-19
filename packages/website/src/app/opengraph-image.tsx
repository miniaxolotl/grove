import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt =
  "Grove by Bramble Labs Inc. — New session. Same context. Self-hosted memory for AI agents.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const sans = readFile(
  join(
    process.cwd(),
    "node_modules/@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff",
  ),
);
const sansSemibold = readFile(
  join(
    process.cwd(),
    "node_modules/@fontsource/dm-sans/files/dm-sans-latin-600-normal.woff",
  ),
);

export default async function OpenGraphImage() {
  const [sansFont, sansSemiboldFont] = await Promise.all([sans, sansSemibold]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#f7f8f5",
        color: "#1d2d26",
        fontFamily: "DM Sans",
        padding: "54px 68px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "relative",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <svg width="36" height="40" viewBox="0 0 40 40" fill="none">
            <path
              d="M20 34V18m0 7-8-8m8 3 8-8m-8 22-5 4m5-4 5 4"
              stroke="#4f6b40"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <path
              d="M19.8 19C11 19 6 13.6 6 6c8.6 0 13.8 5.5 13.8 13ZM20.2 15C20.2 7 25.2 3 33 3c0 7.5-5.1 12-12.8 12Z"
              fill="#4f6b40"
            />
          </svg>
          <span style={{ fontSize: 38, letterSpacing: -2, fontWeight: 600 }}>
            grove.
          </span>
          <span style={{ marginLeft: "auto", fontSize: 18 }}>
            Bramble Labs Inc.
          </span>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 51,
            fontSize: 13,
            letterSpacing: 3,
            color: "#4f6b40",
          }}
        >
          GROVE / AGENT MEMORY
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontWeight: 600,
            fontSize: 88,
            lineHeight: 1.02,
            letterSpacing: -2,
            marginTop: 21,
          }}
        >
          <span>New session.</span>
          <span style={{ color: "#326349" }}>Same context.</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 20,
            marginTop: 27,
            color: "#62695d",
          }}
        >
          Useful context. One private memory account.
        </div>
        <div
          style={{
            display: "flex",
            position: "absolute",
            bottom: 0,
            width: "100%",
            paddingTop: 21,
            borderTop: "1px solid #dddfd4",
            fontSize: 13,
            letterSpacing: 1,
            color: "#4f6b40",
          }}
        >
          OPEN SOURCE · SELF-HOSTED · DEVELOPER TOOLS
        </div>
      </div>
      <div
        style={{
          display: "flex",
          position: "absolute",
          width: 200,
          height: 200,
          right: 70,
          top: 215,
          borderRadius: 12,
          background: "#1d2d26",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid #dce2db",
        }}
      >
        <svg width="82" height="88" viewBox="0 0 40 40" fill="none">
          <path
            d="M20 34V18m0 7-8-8m8 3 8-8m-8 22-5 4m5-4 5 4"
            stroke="#d7e8ae"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M19.8 19C11 19 6 13.6 6 6c8.6 0 13.8 5.5 13.8 13ZM20.2 15C20.2 7 25.2 3 33 3c0 7.5-5.1 12-12.8 12Z"
            fill="#d7e8ae"
          />
        </svg>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "DM Sans",
          data: new Uint8Array(sansFont).buffer,
          weight: 400,
          style: "normal",
        },
        {
          name: "DM Sans",
          data: new Uint8Array(sansSemiboldFont).buffer,
          weight: 600,
          style: "normal",
        },
      ],
    },
  );
}
