"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";

// ============================================================================
// Constants
// ============================================================================

const SCRAMBLE_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?/~`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

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

const visitorLines = {
  withLocation: [
    "I spotted you all the way from {location} 👀",
    "Looks like you're tuning in from {location} 📡",
    "You're beaming in from {location}, I see 🛸",
    "I see you peeking in from {location} 🔭",
  ],
  withoutLocation: [
    "I spotted you from somewhere on the interwebs 👀",
    "Looks like you're tuning in from somewhere cool 📡",
    "You're beaming in from parts unknown, I see 🛸",
    "I see you peeking in from the digital void 🔭",
  ],
};

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
// ScrambleText Component
// ============================================================================

function ScrambleText({
  text,
  className,
  scrambleSpeed = 30,
  revealSpeed = 50,
}: {
  text: string;
  className?: string;
  scrambleSpeed?: number;
  revealSpeed?: number;
}) {
  const [displayText, setDisplayText] = useState("");
  const [isScrambling, setIsScrambling] = useState(false);
  const prevTextRef = useRef(text);
  const frameRef = useRef<number>(0);
  const revealedRef = useRef(0);

  useEffect(() => {
    if (text !== prevTextRef.current || displayText === "") {
      prevTextRef.current = text;
      revealedRef.current = 0;
      setIsScrambling(true);
    }
  }, [text, displayText]);

  useEffect(() => {
    if (!isScrambling || !text) return;

    const scrambleInterval = setInterval(() => {
      frameRef.current++;

      if (frameRef.current % Math.ceil(revealSpeed / scrambleSpeed) === 0) {
        revealedRef.current++;
      }

      let result = "";
      for (let i = 0; i < text.length; i++) {
        if (i < revealedRef.current) {
          result += text[i];
        } else if (text[i] === " ") {
          result += " ";
        } else if (/[\u{1F300}-\u{1F9FF}]/u.test(text[i])) {
          result += text[i];
        } else {
          result += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        }
      }

      setDisplayText(result);

      if (revealedRef.current >= text.length) {
        setIsScrambling(false);
        setDisplayText(text);
        frameRef.current = 0;
      }
    }, scrambleSpeed);

    return () => clearInterval(scrambleInterval);
  }, [isScrambling, text, scrambleSpeed, revealSpeed]);

  return <span className={className}>{displayText}</span>;
}

// ============================================================================
// useRotatingContent Hook
// ============================================================================

type RotationPhase = "typing" | "deleting";

function useRotatingContent({
  greetings,
  personas,
  personaTypingSpeed = 6,
  personaDeleteSpeed = 3,
  displayDuration = 4000,
}: {
  greetings: string[];
  personas: Persona[];
  personaTypingSpeed?: number;
  personaDeleteSpeed?: number;
  displayDuration?: number;
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
    let timeout: ReturnType<typeof setTimeout>;

    if (phase === "typing") {
      const isDone = positionText.length >= positionTarget.length &&
                     descriptionText.length >= descriptionTarget.length;

      if (!isDone) {
        timeout = setTimeout(() => {
          if (positionText.length < positionTarget.length) {
            setPositionText(positionTarget.slice(0, positionText.length + 1));
          }
          if (descriptionText.length < descriptionTarget.length) {
            setDescriptionText(descriptionTarget.slice(0, descriptionText.length + 1));
          }
        }, personaTypingSpeed);
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
      personaTypingSpeed, personaDeleteSpeed, displayDuration,
      greetings.length, personas.length]);

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
// Helpers
// ============================================================================

interface GreetingData {
  timePeriod: string;
  location: string;
}

function getGreetingData(): GreetingData {
  if (typeof document === "undefined") {
    return { timePeriod: "morning", location: "" };
  }

  const match = document.cookie.match(/visitor-greeting-data=([^;]+)/);
  if (match) {
    try {
      let data = decodeURIComponent(match[1]);
      if (data.includes("%")) {
        data = decodeURIComponent(data);
      }
      return JSON.parse(data);
    } catch {
      return { timePeriod: "morning", location: "" };
    }
  }
  return { timePeriod: "morning", location: "" };
}

function getVisitorLine(location: string): string {
  const lines = location ? visitorLines.withLocation : visitorLines.withoutLocation;
  const line = lines[Math.floor(Math.random() * lines.length)];
  return location ? line.replace("{location}", location) : line;
}

// ============================================================================
// HeroAnimations Component
// ============================================================================

export default function HeroAnimations({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [greetingData, setGreetingData] = useState<GreetingData>({ timePeriod: "morning", location: "" });
  const [visitorLine, setVisitorLine] = useState("");

  useEffect(() => {
    setMounted(true);
    const data = getGreetingData();
    setGreetingData(data);
    setVisitorLine(getVisitorLine(data.location));
  }, []);

  const greetings = greetingsByPeriod[greetingData.timePeriod] || defaultGreetings;

  const {
    greetingTarget,
    positionText,
    descriptionText,
    showCursor,
    isDescriptionComplete,
  } = useRotatingContent({
    greetings,
    personas,
    personaTypingSpeed: 3,
    personaDeleteSpeed: 2,
    displayDuration: 2500,
  });

  return (
    <>
      {/* Visitor + Greeting lines — empty before mount, scramble after */}
      <div className="space-y-1">
        <div className="h-5">
          {mounted && (
            <ScrambleText
              text={visitorLine}
              className="text-muted/60 text-xs font-medium tracking-wide"
              scrambleSpeed={15}
              revealSpeed={12}
            />
          )}
        </div>
        <div className="h-6 flex items-center gap-2">
          {mounted && (
            <>
              <span className="text-accent/50 text-sm">└</span>
              <ScrambleText
                text={greetingTarget}
                className="text-accent text-sm font-medium tracking-wide"
                scrambleSpeed={20}
                revealSpeed={15}
              />
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Static heading passed from server component — always in HTML */}
        {children}

        {/* Position — typed after mount */}
        <div className="min-h-[2rem] md:min-h-[2.5rem]">
          {mounted && (
            <span className="block text-xl md:text-3xl font-medium tracking-[-0.01em] text-muted">
              {positionText}
            </span>
          )}
        </div>

        {/* Description with cursor — typed after mount */}
        <div className="min-h-[1.75rem] md:min-h-[2rem]">
          {mounted && (
            <span className="text-base md:text-lg text-muted/80 leading-[1.7]" style={{ display: "inline" }}>
              {descriptionText}
              <span
                className={`bg-accent ${isDescriptionComplete && showCursor ? "opacity-100" : "opacity-0"}`}
                style={{
                  display: "inline-block",
                  width: "0.6em",
                  height: "1.1em",
                  marginLeft: "3px",
                  verticalAlign: "text-bottom",
                }}
              />
            </span>
          )}
        </div>
      </div>
    </>
  );
}
