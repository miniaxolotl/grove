import { ImageResponse } from "next/og";
import { groveLeaves, groveStem } from "@/lib/brand-mark";

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
        background: "#243d30",
      }}
    >
      <svg width="112" height="120" viewBox="0 0 40 40" fill="none">
        <path
          d={groveStem}
          stroke="#d7e8ae"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path d={groveLeaves} fill="#d7e8ae" />
      </svg>
    </div>,
    size,
  );
}
