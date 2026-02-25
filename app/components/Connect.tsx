"use client";

import { motion } from "framer-motion";
import { Mail, Github, Linkedin, Instagram } from "lucide-react";

const socialLinks = [
  {
    name: "LinkedIn",
    href: "https://linkedin.com/in/wentaohe",
    icon: Linkedin,
  },
  {
    name: "GitHub",
    href: "https://github.com/wth-gg",
    icon: Github,
  },
  {
    name: "Instagram",
    href: "https://www.instagram.com/taustitos/",
    icon: Instagram,
  },
  {
    name: "Email",
    href: "mailto:me@wentao.gg",
    icon: Mail,
  },
];

export default function Connect() {
  return (
    <section id="connect" className="py-24 px-6 relative z-20 pointer-events-none">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4 tracking-tight">
            Let&apos;s Connect
          </h2>
          <div className="w-16 h-1 bg-accent mx-auto mb-6" />
          <p className="text-muted text-lg max-w-2xl mx-auto">
            I&apos;m always open to discussing new opportunities, interesting projects,
            or just having a chat about technology. Feel free to reach out!
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
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
                y: -8,
                scale: 1.15,
                transition: { type: "spring", stiffness: 700, damping: 12 }
              }}
              whileTap={{ scale: 0.92, transition: { type: "spring", stiffness: 800, damping: 15 } }}
              className="group bg-white/5 backdrop-blur-lg hover:bg-white/10 rounded-xl p-5 border border-white/10 hover:border-white/20 hover:card-shadow transition-colors duration-150 pointer-events-auto animate-breathe"
              aria-label={link.name}
            >
              <div className="flex items-center justify-center w-12 h-12 bg-background rounded-xl group-hover:bg-accent/10 transition-colors">
                <link.icon
                  size={24}
                  className="text-muted group-hover:text-accent transition-colors"
                />
              </div>
            </motion.a>
          ))}
        </motion.div>

      </div>
    </section>
  );
}
