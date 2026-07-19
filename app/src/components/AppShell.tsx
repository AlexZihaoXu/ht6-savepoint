import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { AnimatePresence } from "framer-motion";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { PageTransition } from "./PageTransition";
import { PageFallback } from "./PageFallback";

// Route-level code-splitting: each page is its own chunk, so the initial
// bundle stays small and route-only dependencies download only when that
// screen is opened.
const PeopleModal = lazy(() =>
  import("@/components/PeopleModal").then((m) => ({ default: m.PeopleModal })),
);
const PlazaPage = lazy(() =>
  import("@/pages/PlazaPage").then((m) => ({ default: m.PlazaPage })),
);
const DayScenePage = lazy(() =>
  import("@/pages/DayScenePage").then((m) => ({ default: m.DayScenePage })),
);
const RecordPage = lazy(() =>
  import("@/pages/RecordPage").then((m) => ({ default: m.RecordPage })),
);
const VoiceSetupPage = lazy(() =>
  import("@/pages/VoiceSetupPage").then((m) => ({
    default: m.VoiceSetupPage,
  })),
);

/**
 * Animated, suspense-wrapped route element. The Suspense boundary sits INSIDE
 * the PageTransition so the shell (top bar + bottom nav) never unmounts and
 * exit/enter animations keep working while a chunk downloads.
 */
function page(Page: ComponentType, fullBleed = false) {
  return (
    <PageTransition fullBleed={fullBleed}>
      <Suspense fallback={<PageFallback />}>
        <Page />
      </Suspense>
    </PageTransition>
  );
}

/**
 * App layout: sticky TopBar, an animated scrollable content region, and a
 * fixed BottomNav. Routes are wrapped in <AnimatePresence mode="wait"> keyed on
 * the pathname so every navigation animates (fade + slide) via PageTransition.
 *
 * The immersive pixel screens (/plaza, /scene/*, /people*) bring their OWN
 * chrome — wooden header + mockup bottom bar — so the classic TopBar/BottomNav
 * and the padded reading column are skipped for them.
 */
export function AppShell() {
  const location = useLocation();
  // Every current screen brings its own pixel chrome (wooden header + mockup
  // bottom bar) — the classic TopBar/BottomNav shell stays for any future
  // plain page (settings etc.).
  const immersive =
    location.pathname.startsWith("/plaza") ||
    location.pathname.startsWith("/scene") ||
    location.pathname.startsWith("/people") ||
    location.pathname.startsWith("/record") ||
    location.pathname.startsWith("/voice-setup");

  // New screen → start reading from the top (the window is the scroller).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {!immersive && <TopBar />}
      <main
        id="main-content"
        tabIndex={-1}
        className={immersive ? "app-main-flush" : "app-main"}
      >
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            {/* The plaza (page 1) + garden (page 2 of /plaza) IS the app.
                Old scaffold screens (/classic, /garden, /day/:date) are gone —
                any stray link falls through the wildcard back to the plaza. */}
            <Route path="/" element={<Navigate to="/plaza" replace />} />
            <Route path="/plaza" element={page(PlazaPage, true)} />
            <Route path="/scene" element={page(DayScenePage, true)} />
            <Route path="/scene/:date" element={page(DayScenePage, true)} />
            {/* People is a pop-up overlay now, not a full page (waterprism);
                the /people/:id deep-link opens that person's profile on top. */}
            <Route path="/people" element={page(PeopleModal, true)} />
            <Route path="/people/:id" element={page(PeopleModal, true)} />
            <Route path="/record" element={page(RecordPage, true)} />
            <Route path="/voice-setup" element={page(VoiceSetupPage, true)} />
            <Route path="*" element={<Navigate to="/plaza" replace />} />
          </Routes>
        </AnimatePresence>
      </main>
      {!immersive && <BottomNav />}
    </div>
  );
}
