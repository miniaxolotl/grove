import { ImageResponse } from "next/og";
import { groveSprout } from "@/lib/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        background: "#284c38",
      }}
    >
      <svg width="112" height="112" viewBox="0 5 100 100" fill="none">
        <path d={groveSprout} fill="#faf9f3" />
      </svg>
    </div>,
    size,
  );
}
