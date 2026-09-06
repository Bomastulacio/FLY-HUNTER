import "./index.css";
import React from "react";
import { Composition } from "remotion";
import { FlyHunterPromo } from "./FlyHunterPromo";
import { NightmareScene } from "./scenes/NightmareScene";
import { RevealScene } from "./scenes/RevealScene";
import { DualEngineScene } from "./scenes/DualEngineScene";
import { DealAlertScene } from "./scenes/DealAlertScene";
import { CtaScene } from "./scenes/CtaScene";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Composición Principal del Video Completo (9:16 Vertical, 24 segundos) */}
      <Composition
        id="FlyHunterPromo"
        component={FlyHunterPromo}
        durationInFrames={720}
        fps={30}
        width={1080}
        height={1920}
      />

      {/* Composiciones Individuales para inspeccionar y trabajar cada escena */}
      <Composition
        id="Scene1-Nightmare"
        component={NightmareScene}
        durationInFrames={135}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="Scene2-Reveal"
        component={RevealScene}
        durationInFrames={135}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="Scene3-DualEngine"
        component={DualEngineScene}
        durationInFrames={240}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="Scene4-DealAlert"
        component={DealAlertScene}
        durationInFrames={120}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        id="Scene5-CTA"
        component={CtaScene}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
