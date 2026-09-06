import React from "react";
import {
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Sparkles, Star } from "lucide-react";
import { BackgroundGrid } from "../components/BackgroundGrid";
import { Subtitles } from "../components/Subtitles";

export const CtaScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    config: {
      damping: 12,
      stiffness: 110,
    },
  });

  const buttonPulse = 1 + Math.sin(frame * 0.2) * 0.04;

  const floatingBadges = [
    { emoji: "🌴", x: 120, y: 380, label: "Miami $420" },
    { emoji: "🗼", x: 820, y: 440, label: "Madrid $490" },
    { emoji: "⛩️", x: 140, y: 1200, label: "Tokio $780" },
    { emoji: "🍕", x: 800, y: 1140, label: "Roma $530" },
  ];

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingBottom: 140,
      }}
    >
      <BackgroundGrid tint="blue" />

      {/* Floating Destination Badges */}
      {floatingBadges.map((badge, idx) => {
        const floatY = Math.sin((frame + idx * 40) * 0.08) * 15;
        return (
          <div
            key={idx}
            style={{
              position: "absolute",
              left: badge.x,
              top: badge.y + floatY,
              backgroundColor: "rgba(15, 23, 42, 0.85)",
              border: "1px solid rgba(56, 189, 248, 0.35)",
              borderRadius: 999,
              padding: "10px 22px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)",
              fontSize: 22,
              fontWeight: 800,
              color: "#38bdf8",
              pointerEvents: "none",
              zIndex: 20,
            }}
          >
            <span>{badge.emoji}</span>
            <span>{badge.label}</span>
          </div>
        );
      })}

      {/* Main Container */}
      <div
        style={{
          width: 900,
          backgroundColor: "rgba(10, 20, 38, 0.96)",
          border: "2.5px solid rgba(56, 189, 248, 0.6)",
          borderRadius: 44,
          padding: "60px 48px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          boxShadow: "0 0 90px -10px rgba(6, 182, 212, 0.45)",
          transform: `scale(${entrance})`,
          opacity: entrance,
          zIndex: 30,
        }}
      >
        {/* Airplane Emblem */}
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 36,
            background: "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 64,
            boxShadow: "0 0 50px rgba(6, 182, 212, 0.8)",
            marginBottom: 32,
          }}
        >
          🛫
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: 82,
            fontWeight: 900,
            letterSpacing: "-0.03em",
            color: "#ffffff",
            lineHeight: 1.1,
          }}
        >
          FLY HUNTER
        </h1>

        <p
          style={{
            margin: "18px 0 36px",
            fontSize: 38,
            fontWeight: 800,
            background: "linear-gradient(135deg, #38bdf8 0%, #34d399 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-0.01em",
          }}
        >
          Menos pestañas. Más viajes. 🌍
        </p>

        {/* Feature Highlights */}
        <div
          style={{
            display: "flex",
            gap: 18,
            marginBottom: 44,
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(15, 23, 42, 0.85)",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              padding: "12px 24px",
              borderRadius: 16,
              fontSize: 22,
              fontWeight: 700,
              color: "#38bdf8",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Sparkles size={20} />
            <span>Playwright Stealth</span>
          </div>
          <div
            style={{
              backgroundColor: "rgba(15, 23, 42, 0.85)",
              border: "1px solid rgba(52, 211, 153, 0.3)",
              padding: "12px 24px",
              borderRadius: 16,
              fontSize: 22,
              fontWeight: 700,
              color: "#34d399",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Sparkles size={20} />
            <span>LangGraph + Gemini</span>
          </div>
        </div>

        {/* GitHub / Demo CTA Button */}
        <div
          style={{
            width: "100%",
            backgroundColor: "#06b6d4",
            border: "2px solid #38bdf8",
            borderRadius: 26,
            padding: "26px 36px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            color: "#05070e",
            fontSize: 30,
            fontWeight: 900,
            transform: `scale(${buttonPulse})`,
            boxShadow: "0 10px 45px rgba(6, 182, 212, 0.65)",
          }}
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ flexShrink: 0 }}
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
            />
          </svg>
          <span>github.com/Bomastulacio/FLY-HUNTER</span>
          <Star size={32} fill="#05070e" />
        </div>
      </div>

      {/* Kinetic Subtitles */}
      <Subtitles
        text="Fly Hunter. Dejá que la IA viaje por vos 🛫"
        highlightWord="Fly Hunter"
        theme="cyan"
      />
    </div>
  );
};
