import { AnimatePresence } from "framer-motion";
import { Route, Routes, useLocation } from "react-router-dom";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { PageTransition } from "./PageTransition";
import { TodayPage } from "@/pages/TodayPage";
import { GardenPage } from "@/pages/GardenPage";
import { PeoplePage } from "@/pages/PeoplePage";
import { PersonPage } from "@/pages/PersonPage";
import { DayViewPage } from "@/pages/DayViewPage";

/**
 * App layout: sticky TopBar, an animated scrollable content region, and a
 * fixed BottomNav. Routes are wrapped in <AnimatePresence mode="wait"> keyed on
 * the pathname so every navigation animates (fade + slide) via PageTransition.
 */
export function AppShell() {
  const location = useLocation();

  return (
    <div className="app-shell">
      <TopBar />
      <main className="app-main">
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route
              path="/"
              element={
                <PageTransition>
                  <TodayPage />
                </PageTransition>
              }
            />
            <Route
              path="/garden"
              element={
                <PageTransition>
                  <GardenPage />
                </PageTransition>
              }
            />
            <Route
              path="/people"
              element={
                <PageTransition>
                  <PeoplePage />
                </PageTransition>
              }
            />
            <Route
              path="/people/:id"
              element={
                <PageTransition>
                  <PersonPage />
                </PageTransition>
              }
            />
            <Route
              path="/day/:date"
              element={
                <PageTransition>
                  <DayViewPage />
                </PageTransition>
              }
            />
            <Route
              path="*"
              element={
                <PageTransition>
                  <TodayPage />
                </PageTransition>
              }
            />
          </Routes>
        </AnimatePresence>
      </main>
      <BottomNav />
    </div>
  );
}
