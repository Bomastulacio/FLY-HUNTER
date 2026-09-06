import React from "react";
import { Series } from "remotion";
import { NightmareScene } from "./scenes/NightmareScene";
import { RevealScene } from "./scenes/RevealScene";
import { DualEngineScene } from "./scenes/DualEngineScene";
import { DealAlertScene } from "./scenes/DealAlertScene";
import { CtaScene } from "./scenes/CtaScene";

export const FlyHunterPromo: React.FC = () => {
  return (
    <Series>
      {/* Escena 1: El Dolor / La Pesadilla de las 47 pestañas (0s - 4.5s) */}
      <Series.Sequence durationInFrames={135}>
        <NightmareScene />
      </Series.Sequence>

      {/* Escena 2: Revelación de Fly Hunter & Radar HUD (4.5s - 9.0s) */}
      <Series.Sequence durationInFrames={135}>
        <RevealScene />
      </Series.Sequence>

      {/* Escena 3: El Doble Motor - Playwright Stealth + LangGraph Gemini (9.0s - 17.0s) */}
      <Series.Sequence durationInFrames={240}>
        <DualEngineScene />
      </Series.Sequence>

      {/* Escena 4: Notificación de Ganga Cazada / 61% OFF (17.0s - 21.0s) */}
      <Series.Sequence durationInFrames={120}>
        <DealAlertScene />
      </Series.Sequence>

      {/* Escena 5: Call to Action Final & GitHub (21.0s - 24.0s) */}
      <Series.Sequence durationInFrames={90}>
        <CtaScene />
      </Series.Sequence>
    </Series>
  );
};
