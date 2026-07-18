import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { AnimatePresence } from "framer-motion";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { PageTransition } from "./PageTransition";
import { PageFallback } from "./PageFallback";

// Route-level code-splitting: each page is its own chunk, so the initial
// bundle stays small and route-only dependencies (e.g. the Garden's HeroUI
// Calendar) download only when that screen is opened.
const TodayPage = lazy(() =>
  import("@/pages/TodayPage").then((m) => ({ default: m.TodayPage })),
);
const GardenPage = lazy(() =>
  import("@/pages/GardenPage").then((m) => ({ default: m.GardenPage })),
);
const PeoplePage = lazy(() =>
  import("@/pages/PeoplePage").then((m) => ({ default: m.PeoplePage })),
);
const PersonPage = lazy(() =>
  import("@/pages/PersonPage").then((m) => ({ default: m.PersonPage })),
);
const DayViewPage = lazy(() =>
  import("@/pages/DayViewPage").then((m) => ({ default: m.DayViewPage })),
);
const PlazaPage = lazy(() =>
  import("@/pages/PlazaPage").then((m) => ({ default: m.PlazaPage })),
);
const DayScenePage = lazy(() =>
  import("@/pages/DayScenePage").then((m) => ({ default: m.DayScenePage })),
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
 * The immersive pixel screens (/plaza and /scene/*) bring their OWN chrome —
 * wooden header + mockup bottom bar — so the classic TopBar/BottomNav and the
 * padded reading column are skipped for them.
 */
export function AppShell() {
  const location = useLocation();
  const immersive =
    location.pathname.startsWith("/plaza") ||
    location.pathname.startsWith("/scene");

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
            {/* the redesign IS the app — land on the plaza */}
            <Route path="/" element={<Navigate to="/plaza" replace />} />
            <Route path="/classic" element={page(TodayPage)} />
            <Route path="/garden" element={page(GardenPage)} />
            <Route path="/plaza" element={page(PlazaPage, true)} />
            <Route path="/scene" element={page(DayScenePage, true)} />
            <Route path="/scene/:date" element={page(DayScenePage, true)} />
            <Route path="/people" element={page(PeoplePage)} />
            <Route path="/people/:id" element={page(PersonPage)} />
            <Route path="/day/:date" element={page(DayViewPage)} />
            <Route path="*" element={<Navigate to="/plaza" replace />} />
          </Routes>
        </AnimatePresence>
      </main>
      {!immersive && <BottomNav />}
    </div>
  );
}
