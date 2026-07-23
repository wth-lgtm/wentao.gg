"use client";

import { useState, useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

const SCRAMBLE_CHARS =
  "!@#$%^&*()_+-=[]{}|;:,.<>?/~`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// Decodes text with a per-character scramble→reveal animation (the site's terminal
// signature). Emoji and spaces are passed through untouched. Under prefers-reduced-motion
// the final text is shown immediately.
export default function ScrambleText({
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
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      setDisplayText(text);
      setIsScrambling(false);
      return;
    }
    if (text !== prevTextRef.current || displayText === "") {
      prevTextRef.current = text;
      revealedRef.current = 0;
      setIsScrambling(true);
    }
  }, [text, displayText, reduceMotion]);

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
