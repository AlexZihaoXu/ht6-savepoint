import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Wraps a route's content so it fades/slides in and out. Used together with
 * <AnimatePresence mode="wait"> in AppShell, keyed on the pathname, so EVERY
 * route change animates smoothly.
 *
 * Respects prefers-reduced-motion (Alex's explicit requirement): when reduced,
 * we drop the vertical slide and shorten the fade to a barely-there crossfade.
 */
export function PageTransition({
  children,
  fullBleed = false,
}: {
  children: ReactNode;
  /** Immersive screens (plaza / day scene) span edge-to-edge, no column padding. */
  fullBleed?: boolean;
}) {
  const reduce = useReducedMotion();

  const variants: Variants = reduce
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -14 },
      };

  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{
        duration: reduce ? 0.12 : 0.28,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={fullBleed ? "app-column-flush" : "app-column"}
    >
      {children}
    </motion.div>
  );
}
