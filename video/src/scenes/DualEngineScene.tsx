import React from "react";
import {
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  BrainCircuit,
  CheckCircle2,
  Cpu,
  DollarSign,
  RefreshCw,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { BackgroundGrid } from "../components/BackgroundGrid";
import { Subtitles } from "../components/Subtitles";

export const DualEngineScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Phase transition between Engine 1 and Engine 2
  const isEngineTwo = frame >= 120;

  // Springs
  const titleSpring = spring({ frame, fps, config: { damping: 14 } });
  const cardOneSpring = spring({ frame: frame - 10, fps, config: { damping: 13 } });
  const cardTwoSpring = spring({ frame: frame - 25, fps, config: { damping: 13 } });

  // Rotating refresh icon in LangGraph loop
  const loopAngle = (frame * 6) % 360;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: 130,
      }}
    >
      <BackgroundGrid tint={isEngineTwo ? "purple" : "emerald"} />

      {/* Header */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginBottom: 35,
          transform: `scale(${titleSpring})`,
          opacity: titleSpring,
          zIndex: 30,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            backgroundColor: "rgba(168, 85, 247, 0.18)",
            border: "1px solid rgba(168, 85, 247, 0.5)",
            padding: "10px 28px",
            borderRadius: 999,
            marginBottom: 12,
            boxShadow: "0 0 25px rgba(168, 85, 247, 0.3)",
          }}
        >
          <Cpu size={24} color="#c084fc" />
          <span
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: "#c084fc",
              letterSpacing: "0.15em",
            }}
          >
            ARQUITECTURA DUAL-ENGINE
          </span>
          <Sparkles size={24} color="#c084fc" />
        </div>

        <h2
          style={{
            margin: 0,
            fontSize: 64,
            fontWeight: 900,
            color: "#ffffff",
            textAlign: "center",
            lineHeight: 1.15,
          }}
        >
          Doble Motor en Acción ⚡
        </h2>
      </div>

      {/* Card 1: Playwright Stealth Engine */}
      <div
        style={{
          width: 900,
          backgroundColor: "rgba(10, 20, 35, 0.94)",
          border: !isEngineTwo
            ? "2.5px solid #10b981"
            : "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: 28,
          padding: "30px 36px",
          boxShadow: !isEngineTwo
            ? "0 0 60px -5px rgba(16, 185, 129, 0.5)"
            : "0 15px 30px rgba(0, 0, 0, 0.4)",
          transform: `scale(${cardOneSpring}) scale(${!isEngineTwo ? 1.02 : 0.98})`,
          opacity: !isEngineTwo ? 1 : 0.65,
          transition: "all 0.4s ease",
          zIndex: 25,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                backgroundColor: "rgba(16, 185, 129, 0.25)",
                padding: 12,
                borderRadius: 16,
              }}
            >
              <Terminal size={36} color="#34d399" />
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#34d399", letterSpacing: "0.08em" }}>
                MOTOR 1 • COSTO $0
              </div>
              <h3 style={{ margin: 0, fontSize: 32, fontWeight: 800, color: "#f8fafc" }}>
                Playwright Stealth Scalper
              </h3>
            </div>
          </div>

          <div
            style={{
              backgroundColor: "rgba(16, 185, 129, 0.2)",
              border: "1.5px solid #10b981",
              padding: "8px 20px",
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#34d399",
              fontSize: 20,
              fontWeight: 800,
            }}
          >
            <DollarSign size={22} />
            <span>COSTO API: $0.00</span>
          </div>
        </div>

        {/* Terminal mock */}
        <div
          style={{
            backgroundColor: "rgba(5, 10, 20, 0.95)",
            borderRadius: 16,
            padding: "18px 24px",
            fontFamily: "monospace",
            fontSize: 22,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ color: "#38bdf8" }}>
            ❯ playwright.launch({`{ stealth: true, anti_bot: "bypassed" }`})
          </div>
          <div style={{ color: "#34d399" }}>
            ✔ Google Flights & Despegar raspados sin gastar tokens.
          </div>
        </div>
      </div>

      {/* Animated Bridge / Connection Pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          backgroundColor: "rgba(30, 41, 59, 0.9)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          padding: "6px 20px",
          borderRadius: 999,
          color: "#94a3b8",
          fontSize: 18,
          fontWeight: 700,
          margin: "6px 0 20px",
          zIndex: 20,
        }}
      >
        <span>Flujo Híbrido en Tiempo Real</span>
        <Zap size={18} color="#fbbf24" />
      </div>

      {/* Card 2: LangGraph State Machine Loop */}
      <div
        style={{
          width: 900,
          backgroundColor: "rgba(15, 20, 38, 0.95)",
          border: isEngineTwo
            ? "2.5px solid #a855f7"
            : "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: 28,
          padding: "30px 36px",
          boxShadow: isEngineTwo
            ? "0 0 70px -5px rgba(168, 85, 247, 0.6)"
            : "0 15px 30px rgba(0, 0, 0, 0.4)",
          transform: `scale(${cardTwoSpring}) scale(${isEngineTwo ? 1.02 : 0.98})`,
          opacity: isEngineTwo ? 1 : 0.65,
          transition: "all 0.4s ease",
          zIndex: 25,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                backgroundColor: "rgba(168, 85, 247, 0.25)",
                padding: 12,
                borderRadius: 16,
              }}
            >
              <BrainCircuit size={36} color="#c084fc" />
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#c084fc", letterSpacing: "0.08em" }}>
                MOTOR 2 • RAZONAMIENTO LLM
              </div>
              <h3 style={{ margin: 0, fontSize: 32, fontWeight: 800, color: "#f8fafc" }}>
                LangGraph + Gemini Flash
              </h3>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              backgroundColor: "rgba(168, 85, 247, 0.2)",
              border: "1.5px solid #a855f7",
              padding: "8px 20px",
              borderRadius: 999,
              color: "#c084fc",
              fontSize: 18,
              fontWeight: 800,
            }}
          >
            <RefreshCw
              size={20}
              style={{ transform: `rotate(${loopAngle}deg)` }}
            />
            <span>SELF-HEALING LOOP</span>
          </div>
        </div>

        {/* Thought / Action Bubble */}
        <div
          style={{
            backgroundColor: "rgba(22, 16, 40, 0.95)",
            border: "1.5px solid rgba(168, 85, 247, 0.35)",
            borderRadius: 18,
            padding: "22px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 22,
              fontWeight: 700,
              color: "#f87171",
            }}
          >
            <span>Tarifa original: $1,120 USD</span>
            <span style={{ fontSize: 18, color: "#94a3b8" }}>
              (Excede presupuesto por $120)
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              backgroundColor: "rgba(168, 85, 247, 0.2)",
              padding: "14px 20px",
              borderRadius: 14,
              color: "#f3e8ff",
              fontSize: 22,
              fontWeight: 600,
            }}
          >
            <Zap size={24} color="#c084fc" />
            <span>
              <strong>Gemini Crítico:</strong> "Mover salida a un jueves ahorra 28%..."
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 26,
              fontWeight: 800,
              color: "#34d399",
            }}
          >
            <CheckCircle2 size={30} color="#34d399" />
            <span>¡Auto-corrección exitosa: Vuelo a $490 USD! 🎉</span>
          </div>
        </div>
      </div>

      {/* Kinetic Subtitles */}
      {isEngineTwo ? (
        <Subtitles
          text="Gemini Flash con LangGraph auto-corrige fechas para encontrar el tesoro oculto 💎"
          highlightWord="auto-corrige"
          theme="gold"
        />
      ) : (
        <Subtitles
          text="¿El truco? Playwright en modo ninja raspando la web a costo cero de APIs 🥷"
          highlightWord="costo cero"
          theme="emerald"
        />
      )}
    </div>
  );
};
