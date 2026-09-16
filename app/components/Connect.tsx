"use client";

import { motion } from "framer-motion";
import { Mail, Github, Linkedin } from "lucide-react";
import { numberOf } from "./sections";

// Email first: the paragraph above the tiles ends "email is fastest", and the tile it
// points at was the last of three.
const socialLinks = [
  {
    name: "Email",
    href: "mailto:me@wentao.gg",
    icon: Mail,
  },
  {
    name: "LinkedIn",
    href: "https://linkedin.com/in/wentaohe",
    icon: Linkedin,
  },
  {
    name: "GitHub",
    href: "https://github.com/wth-lgtm",
    icon: Github,
  },
];

export default function Connect() {
  return (
    <section id="connect" aria-label="Get in touch" className="py-20 md:py-24 px-6 relative z-20 pointer-events-none">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <div className="flex items-center justify-center gap-3 mb-3">
            <span className="font-mono text-xs tracking-[0.25em] text-muted">{numberOf("connect")}</span>
            <span className="h-px w-12 bg-border" />
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6 tracking-tight heading-legible">
            Say hello
          </h2>
          {/* The hero CTA and the nav footer both land here, so this paragraph is the
              site's actual pitch. Facts come from layout.tsx's DESCRIPTION — the title is
              "Engineering Lead on Mercor's Applied AI team", not an upgrade of it. */}
          <p className="text-muted text-lg max-w-2xl mx-auto text-legible">
            Engineering Lead on Mercor&apos;s Applied AI team, in San Francisco; evenings go to
            things like the whale tracker above. If you&apos;re building data infrastructure,
            want to argue about a leaderboard, or are in SF and want coffee — email is fastest.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="flex justify-center gap-5"
        >
          {socialLinks.map((link, index) => (
            <motion.a
              key={link.name}
              href={link.href}
              target={link.name !== "Email" ? "_blank" : undefined}
              rel={link.name !== "Email" ? "noopener noreferrer" : undefined}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              whileHover={{
                y: -4,
                scale: 1.03,
                transition: { type: "spring", stiffness: 300, damping: 20 }
              }}
              whileTap={{ scale: 0.96, transition: { type: "spring", stiffness: 400, damping: 22 } }}
              className="group glass flex flex-col items-center gap-2.5 p-5 hover:border-muted/40 pointer-events-auto"
              // The same word as the visible label below, so the name a screen reader
              // gets and the name a sighted visitor reads cannot drift apart.
              aria-label={link.name}
            >
              <div className="flex items-center justify-center w-12 h-12 bg-background rounded-xl group-hover:bg-accent/10 transition-colors">
                <link.icon
                  size={24}
                  className="text-muted group-hover:text-accent transition-colors"
                />
              </div>
              {/* Icon-only tiles asked the visitor to recognise three glyphs; the mail
                  envelope reads, a lower-case "in" and an octocat less so. The name is
                  printed, in the etched legend the rest of the site labels things with. */}
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
                {link.name}
              </span>
            </motion.a>
          ))}
        </motion.div>

      </div>
    </section>
  );
}
