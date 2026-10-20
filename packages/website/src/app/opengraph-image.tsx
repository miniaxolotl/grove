import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { groveSprout } from "@/lib/brand-mark";
import { positioning } from "@/content/site";

export const alt = positioning.imageAlt;
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
const logo = readFile(join(process.cwd(), "public/brand/grove-logo.svg"));

export default async function OpenGraphImage() {
  const [sansFont, sansSemiboldFont, logoSvg] = await Promise.all([
    sans,
    sansSemibold,
    logo,
  ]);

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
          {/* ImageResponse renders the outlined logo directly into the image. */}
          <img
            src={`data:image/svg+xml;base64,${logoSvg.toString("base64")}`}
            width={198}
            height={36}
            alt="Grove"
          />
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
          YOUR PRIVATE NOTEBOOK
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
          <span>Good ideas.</span>
          <span style={{ color: "#326349" }}>Room to grow.</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 20,
            marginTop: 27,
            color: "#62695d",
          }}
        >
          Notes, plans, and a little more space to think.
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
          NOTES · JOURNAL · IDEAS, CONNECTED
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
          background: "#284c38",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid #dce2db",
        }}
      >
        <svg width="108" height="108" viewBox="0 5 100 100" fill="none">
          <path d={groveSprout} fill="#faf9f3" />
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
