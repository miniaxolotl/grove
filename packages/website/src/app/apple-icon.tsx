import { ImageResponse } from "next/og";

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
          d="M20 34V18m0 7-8-8m8 3 8-8m-8 22-5 4m5-4 5 4"
          stroke="#d7e8ae"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M19.8 19C11 19 6 13.6 6 6c8.6 0 13.8 5.5 13.8 13ZM20.2 15C20.2 7 25.2 3 33 3c0 7.5-5.1 12-12.8 12Z"
          fill="#d7e8ae"
        />
      </svg>
    </div>,
    size,
  );
}
