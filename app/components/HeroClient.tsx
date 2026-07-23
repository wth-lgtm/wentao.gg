"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import ScrambleText from "./ScrambleText";
import VisitorIntel from "./VisitorIntel";
import MagneticButton from "./MagneticButton";
import { getVisitorData } from "./visitorData";

// ============================================================================
// Constants
// ============================================================================

const greetingsByPeriod: Record<string, string[]> = {
  early_morning: [
    "You're up before the bugs are ☀️",
    "I see the coffee hasn't kicked in yet 🐦",
    "The early dev catches the merge conflict 🌅",
    "Looks like we're both on dawn patrol 💪",
  ],
  morning: [
    "I hope your coffee is as strong as your WiFi ☕",
    "It's another beautiful day to ship some code 🚀",
    "Let's make some bugs... I mean features ✨",
    "It's time to turn caffeine into code ☕",
  ],
  midday: [
    "I see you're on a lunch break scroll 🍕",
    "We're halfway to 5pm — keep pushing 💫",
    "Taking a break from the IDE is always smart 🎯",
    "That midday momentum hits different 🌤️",
  ],
  afternoon: [
    "Looks like you're fighting the afternoon slump ⚡",
    "The post-lunch code review always hits hard 💻",
    "I see you're cruising through the afternoon 🛹",
    "PM productivity mode has been activated 🌞",
  ],
  evening: [
    "Are you wrapping up or just getting started? 🌆",
    "It's prime time for side projects ✨",
    "Welcome to the golden hour of debugging 🔍",
    "When the office clears, the real work begins 🌅",
  ],
  night: [
    "I see you're part of the night owl dev squad 🦉",
    "We debug by moonlight, ship by daylight 🌙",
    "The code always flows better after dark 💻",
    "The stars are out, and so are the bugs ⭐",
  ],
  late_night: [
    "Sleep is just a social construct anyway 🌙",
    "Those 3am commits hit different, don't they? 😅",
    "The best features are written past midnight 🌐",
    "It's just you and the servers now 🚀",
  ],
};

const defaultGreetings = [
  "Well hello there, fellow human 👋",
  "Welcome to my corner of the internet 👋",
  "I'm glad you stopped by 👋",
];

interface Persona {
  position: string;
  description: string;
}

const personas: Persona[] = [
  {
    position: "⚙️ Engineer + 💻 Developer",
    description: "Building infrastructure to scale, shaping data to drive product decisions.",
  },
  {
    position: "🏋️ Powerlifter",
    description: "Compiling strength toward a 900KG total. Currently debugging my squat form.",
  },
];

// ============================================================================
// useRotatingContent Hook — drives the typewriter persona + rotating greeting
// ============================================================================

type RotationPhase = "typing" | "deleting";

function useRotatingContent({
  greetings,
  personas,
  personaTypingSpeed = 6,
  descriptionTypingSpeed = 6,
  personaDeleteSpeed = 3,
  displayDuration = 4000,
  reduceMotion = false,
}: {
  greetings: string[];
  personas: Persona[];
  personaTypingSpeed?: number;
  descriptionTypingSpeed?: number;
  personaDeleteSpeed?: number;
  displayDuration?: number;
  reduceMotion?: boolean;
}) {
  const [greetingIndex, setGreetingIndex] = useState(0);
  const [personaIndex, setPersonaIndex] = useState(0);
  const [positionText, setPositionText] = useState("");
  const [descriptionText, setDescriptionText] = useState("");
  const [phase, setPhase] = useState<RotationPhase>("typing");
  const [showCursor, setShowCursor] = useState(true);
  const rotationCountRef = useRef(0);

  const greetingTarget = greetings[greetingIndex];
  const currentPersona = personas[personaIndex];
  const positionTarget = currentPersona.position;
  const descriptionTarget = currentPersona.description;

  // Blinking cursor
  useEffect(() => {
    const interval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  // Main animation state machine
  useEffect(() => {
    // Reduced motion: render the current persona fully; no typing/deleting loop.
    if (reduceMotion) {
      setPositionText(positionTarget);
      setDescriptionText(descriptionTarget);
      return;
    }

    let timeout: ReturnType<typeof setTimeout>;

    if (phase === "typing") {
      const positionDone = positionText.length >= positionTarget.length;
      const descriptionDone = descriptionText.length >= descriptionTarget.length;

      if (!positionDone || !descriptionDone) {
        // Type the position line first, then the (longer) description — one at a time.
        const baseSpeed = !positionDone ? personaTypingSpeed : descriptionTypingSpeed;
        const jitter = Math.random() * 24 - 12; // ±12ms for a hand-typed cadence
        timeout = setTimeout(() => {
          if (!positionDone) {
            setPositionText(positionTarget.slice(0, positionText.length + 1));
          } else {
            setDescriptionText(descriptionTarget.slice(0, descriptionText.length + 1));
          }
        }, Math.max(baseSpeed + jitter, 0));
      } else {
        timeout = setTimeout(() => setPhase("deleting"), displayDuration);
      }
    } else if (phase === "deleting") {
      const isDone = positionText.length === 0 && descriptionText.length === 0;

      if (!isDone) {
        timeout = setTimeout(() => {
          if (positionText.length > 0) {
            setPositionText(positionText.slice(0, -1));
          }
          if (descriptionText.length > 0) {
            setDescriptionText(descriptionText.slice(0, -1));
          }
        }, personaDeleteSpeed);
      } else {
        setPersonaIndex((prev) => (prev + 1) % personas.length);
        rotationCountRef.current += 1;
        if (rotationCountRef.current % 2 === 0) {
          setGreetingIndex((prev) => (prev + 1) % greetings.length);
        }
        setPhase("typing");
      }
    }

    return () => clearTimeout(timeout);
  }, [phase, positionText, descriptionText, positionTarget, descriptionTarget,
      personaTypingSpeed, descriptionTypingSpeed, personaDeleteSpeed, displayDuration,
      reduceMotion, greetings.length, personas.length]);

  const isDescriptionComplete = phase === "deleting" ||
    (descriptionText.length >= descriptionTarget.length && descriptionText.length > 0);

  return {
    greetingTarget,
    positionText,
    descriptionText,
    showCursor,
    isDescriptionComplete,
  };
}

// ============================================================================
// HeroAnimations — the two-column hero: identity (left) + visitor intel (right)
// ============================================================================

export default function HeroAnimations({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [timePeriod, setTimePeriod] = useState("morning");
  const reduceMotion = useReducedMotion() ?? false;

  useEffect(() => {
    setMounted(true);
    setTimePeriod(getVisitorData().timePeriod);
  }, []);

  const greetings = greetingsByPeriod[timePeriod] || defaultGreetings;

  const {
    greetingTarget,
    positionText,
    descriptionText,
    showCursor,
    isDescriptionComplete,
  } = useRotatingContent({
    greetings,
    personas,
    personaTypingSpeed: 45,
    descriptionTypingSpeed: 34,
    personaDeleteSpeed: 26,
    displayDuration: 4000,
    reduceMotion,
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 md:items-center gap-x-10 gap-y-10">
      {/* ================= LEFT — identity ================= */}
      <div className="md:col-span-7 space-y-4 md:space-y-5 pointer-events-none">
        {/* Greeting kicker (E3) — one quiet mono line above the name */}
        <div className="min-h-5 font-mono text-xs tracking-wide">
          {mounted && (
            <span className="flex items-start gap-2 text-muted/80">
              <span aria-hidden className="text-accent shrink-0">▸</span>
              <ScrambleText
                text={greetingTarget}
                className="min-w-0 text-legible break-words"
                scrambleSpeed={20}
                revealSpeed={15}
              />
            </span>
          )}
        </div>

        {/* Name — the dominant statement (static server HTML, LCP element) */}
        {children}

        {/* Persona position (E4) — typed sub-headline */}
        <div className="min-h-[1.75rem] md:min-h-[2.25rem]">
          {mounted && (
            <span className="block text-lg md:text-2xl font-medium tracking-[-0.01em] text-foreground/85 text-legible">
              {positionText}
            </span>
          )}
        </div>

        {/* Persona description (E5) — quiet, with the blinking accent cursor */}
        <div className="min-h-[1.5rem] md:min-h-[1.75rem]">
          {mounted && (
            <span className="text-sm md:text-base text-muted leading-relaxed text-legible" style={{ display: "inline" }}>
              {descriptionText}
              <span
                className={`bg-accent ${isDescriptionComplete && showCursor ? "opacity-100" : "opacity-0"}`}
                style={{
                  display: "inline-block",
                  width: "0.55em",
                  height: "1.05em",
                  marginLeft: "3px",
                  verticalAlign: "text-bottom",
                }}
              />
            </span>
          )}
        </div>
      </div>

      {/* ================= RIGHT — visitor intel rail ================= */}
      <div className="md:col-span-5 pointer-events-auto">
        <div className="mx-auto w-full max-w-sm space-y-4 md:mx-0 md:max-w-none">
          <VisitorIntel />
          <MagneticButton
            href="#connect"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Get in touch
            <ArrowUpRight size={16} />
          </MagneticButton>
        </div>
      </div>
    </div>
  );
}
