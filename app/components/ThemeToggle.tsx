"use client";

import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const options = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
  { value: "system" as const, label: "System", icon: Monitor },
];

export default function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  // Roving tabindex: one item is tabbable at a time and the arrows move it. role="menu"
  // promises this keyboard model, so the roles and the behaviour ship together.
  const [activeIndex, setActiveIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus follows the roving index — on open it lands on the checked option, after that on
  // whatever the arrows picked.
  useEffect(() => {
    if (!isOpen) return;
    itemRefs.current[activeIndex]?.focus();
  }, [isOpen, activeIndex]);

  const closeMenu = (restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  const openMenu = () => {
    const checked = options.findIndex((o) => o.value === theme);
    setActiveIndex(checked === -1 ? 0 : checked);
    setIsOpen(true);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!isOpen) return;
    const last = options.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => (i >= last ? 0 : i + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => (i <= 0 ? last : i - 1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(last);
        break;
      case "Escape":
        event.preventDefault();
        closeMenu(true);
        break;
      // Tab is deliberately NOT handled here: unmounting the focused item inside the
      // keydown would strip the browser of its starting point and drop focus on <body>.
      // The focusout below closes the menu once the browser has already moved focus on.
    }
  };

  // Focus leaving the popup — by Tab, Shift+Tab or anything else — closes it, so the menu
  // can never keep floating with aria-expanded="true" behind a focus ring somewhere else.
  const onFocusOut = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && menuRef.current?.contains(next)) return;
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        onClick={() => (isOpen ? closeMenu(false) : openMenu())}
        className="p-2 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-card"
        aria-label="Toggle theme"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {resolvedTheme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-36 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50"
          >
            <div ref={menuRef} className="p-1" role="menu" aria-label="Theme" onBlur={onFocusOut}>
              {options.map((option, index) => (
                <button
                  key={option.value}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  role="menuitemradio"
                  aria-checked={theme === option.value}
                  tabIndex={index === activeIndex ? 0 : -1}
                  onClick={() => {
                    setTheme(option.value);
                    closeMenu(true);
                  }}
                  // The checked row used to be `bg-accent text-white`, which is a
                  // hardcoded colour and, on dark, an unreadable one: white on the dark
                  // theme's --accent (#3b82f6) measures 3.68:1, under the 4.5:1 WCAG AA
                  // asks of 14px text. (Light passes at 5.19:1 on #2563eb, so only one
                  // of the two themes was ever legible.) The page colour is the label
                  // instead — #0a0a0b on #3b82f6 is 5.33:1 and #ffffff on #2563eb is
                  // the same 5.19:1 — so one token pair passes in both themes and the
                  // accent chip keeps its emphasis.
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
                    theme === option.value
                      ? "bg-accent text-[var(--background)]"
                      : "text-muted hover:text-foreground hover:bg-background"
                  }`}
                >
                  <option.icon size={16} />
                  {option.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
