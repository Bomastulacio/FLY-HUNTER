import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

export interface SubtitlesProps {
  text: string;
  highlightWord?: string;
  secondaryText?: string;
  theme?: "cyan" | "emerald" | "fire" | "gold";
}

export const Subtitles: React.FC<SubtitlesProps> = ({
  text,
  highlightWord,
  secondaryText,
  theme = "cyan",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    config: {
      damping: 14,
      stiffness: 140,
    },
  });

  const themeColors = {
    cyan: "#38bdf8",
    emerald: "#34d399",
    fire: "#fb7185",
    gold: "#fbbf24",
  };

  const words = text.split(" ");

  return (
    <div
      style={{
        position: "absolute",
        bottom: 140,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 40px",
        zIndex: 50,
        transform: `scale(${entrance}) translateY(${(1 - entrance) * 30}px)`,
        opacity: Math.min(1, entrance * 1.5),
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(10, 15, 29, 0.82)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: 24,
          padding: "20px 36px",
          boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.7)",
          maxWidth: "92%",
          textAlign: "center",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 44,
            fontWeight: 800,
            lineHeight: 1.3,
            color: "#f8fafc",
            letterSpacing: "-0.02em",
          }}
        >
          {words.map((word, i) => {
            const isHighlight =
              highlightWord &&
              word.toLowerCase().includes(highlightWord.toLowerCase());
            return (
              <span
                key={i}
                style={{
                  color: isHighlight ? themeColors[theme] : "#ffffff",
                  textShadow: isHighlight
                    ? `0 0 20px ${themeColors[theme]}88`
                    : "none",
                  marginRight: "0.25em",
                  display: "inline-block",
                }}
              >
                {word}
              </span>
            );
          })}
        </p>

        {secondaryText && (
          <p
            style={{
              margin: "12px 0 0 0",
              fontSize: 32,
              fontWeight: 600,
              color: "#94a3b8",
            }}
          >
            {secondaryText}
          </p>
        )}
      </div>
    </div>
  );
};
